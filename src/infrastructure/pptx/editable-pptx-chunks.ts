import { posix } from "node:path";
import JSZip from "jszip";

const RELATIONSHIP_PATTERN = /<Relationship\b[^>]*\/>/g;

function relationshipAttribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
}

function setRelationshipTarget(tag: string, target: string): string {
  return tag.replace(/\bTarget="[^"]*"/, `Target="${target}"`);
}

function numberedFiles(zip: JSZip, pattern: RegExp): string[] {
  return Object.keys(zip.files)
    .filter((name) => pattern.test(name))
    .sort((left, right) => {
      const leftNumber = Number(left.match(/(\d+)\.xml$/)?.[1] ?? 0);
      const rightNumber = Number(right.match(/(\d+)\.xml$/)?.[1] ?? 0);
      return leftNumber - rightNumber;
    });
}

async function copyZipFile(
  source: JSZip,
  destination: JSZip,
  sourcePath: string,
  destinationPath: string
): Promise<void> {
  const file = source.file(sourcePath);
  if (!file) throw new Error(`PPTX 分批合并缺少资源：${sourcePath}`);
  destination.file(destinationPath, await file.async("uint8array"));
}

function addContentTypeOverride(
  xml: string,
  partName: string,
  contentType: string
): string {
  if (xml.includes(`PartName="${partName}"`)) return xml;
  return xml.replace(
    "</Types>",
    `<Override PartName="${partName}" ContentType="${contentType}"/></Types>`
  );
}

function updateAppProperties(xml: string, slideCount: number): string {
  return xml
    .replace(/<Slides>\d+<\/Slides>/, `<Slides>${slideCount}</Slides>`)
    .replace(/<Notes>\d+<\/Notes>/, `<Notes>${slideCount}</Notes>`);
}

/**
 * Merge dom-to-pptx chunks without flattening their slide XML. Each chunk is
 * created by the same converter and therefore shares one compatible master,
 * layout and theme. Slide-local media and notes are rebased to unique names.
 */
export async function mergeEditablePptxChunks(
  chunks: Buffer[]
): Promise<Buffer> {
  if (chunks.length === 0) throw new Error("没有可合并的 PowerPoint 分批结果");
  if (chunks.length === 1) return chunks[0]!;

  const destination = await JSZip.loadAsync(chunks[0]!);
  let presentation = await destination.file("ppt/presentation.xml")!.async("string");
  let presentationRels = await destination
    .file("ppt/_rels/presentation.xml.rels")!.async("string");
  let contentTypes = await destination.file("[Content_Types].xml")!.async("string");
  let slideCount = numberedFiles(
    destination,
    /^ppt\/slides\/slide\d+\.xml$/
  ).length;
  let nextSlideId = Math.max(
    255,
    ...Array.from(presentation.matchAll(/<p:sldId\b[^>]*\bid="(\d+)"/g))
      .map((match) => Number(match[1]))
  ) + 1;
  let nextPresentationRelId = Math.max(
    0,
    ...Array.from(presentationRels.matchAll(/\bId="rId(\d+)"/g))
      .map((match) => Number(match[1]))
  ) + 1;

  for (const chunk of chunks.slice(1)) {
    const source = await JSZip.loadAsync(chunk);
    const sourceSlides = numberedFiles(
      source,
      /^ppt\/slides\/slide\d+\.xml$/
    );

    for (const sourceSlidePath of sourceSlides) {
      const sourceSlideNumber = Number(
        sourceSlidePath.match(/slide(\d+)\.xml$/)?.[1]
      );
      const destinationSlideNumber = slideCount + 1;
      const destinationSlidePath = `ppt/slides/slide${destinationSlideNumber}.xml`;
      const sourceRelsPath =
        `ppt/slides/_rels/slide${sourceSlideNumber}.xml.rels`;
      const destinationRelsPath =
        `ppt/slides/_rels/slide${destinationSlideNumber}.xml.rels`;

      await copyZipFile(
        source,
        destination,
        sourceSlidePath,
        destinationSlidePath
      );

      const sourceRelsFile = source.file(sourceRelsPath);
      if (sourceRelsFile) {
        let mediaIndex = 0;
        const pendingCopies: Promise<void>[] = [];
        let slideRels = await sourceRelsFile.async("string");
        slideRels = slideRels.replace(RELATIONSHIP_PATTERN, (tag) => {
          const type = relationshipAttribute(tag, "Type") ?? "";
          const target = relationshipAttribute(tag, "Target");
          const external = relationshipAttribute(tag, "TargetMode") === "External";
          if (!target || external) return tag;

          if (type.endsWith("/notesSlide")) {
            const sourceNotesPath = posix.normalize(
              posix.join("ppt/slides", target)
            );
            const destinationNotesPath =
              `ppt/notesSlides/notesSlide${destinationSlideNumber}.xml`;
            const sourceNotesNumber = Number(
              sourceNotesPath.match(/notesSlide(\d+)\.xml$/)?.[1]
            );
            pendingCopies.push(copyZipFile(
              source,
              destination,
              sourceNotesPath,
              destinationNotesPath
            ));
            const sourceNotesRelsPath =
              `ppt/notesSlides/_rels/notesSlide${sourceNotesNumber}.xml.rels`;
            const sourceNotesRels = source.file(sourceNotesRelsPath);
            if (sourceNotesRels) {
              pendingCopies.push((async () => {
                const notesRels = (await sourceNotesRels.async("string"))
                  .replace(
                    /Target="\.\.\/slides\/slide\d+\.xml"/g,
                    `Target="../slides/slide${destinationSlideNumber}.xml"`
                  );
                destination.file(
                  `ppt/notesSlides/_rels/notesSlide${destinationSlideNumber}.xml.rels`,
                  notesRels
                );
              })());
            }
            contentTypes = addContentTypeOverride(
              contentTypes,
              `/ppt/notesSlides/notesSlide${destinationSlideNumber}.xml`,
              "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"
            );
            return setRelationshipTarget(
              tag,
              `../notesSlides/notesSlide${destinationSlideNumber}.xml`
            );
          }

          const sourcePartPath = posix.normalize(
            posix.join("ppt/slides", target)
          );
          if (!sourcePartPath.startsWith("ppt/media/")) return tag;
          mediaIndex += 1;
          const extension = posix.extname(sourcePartPath);
          const destinationPartPath =
            `ppt/media/chunk-slide-${destinationSlideNumber}-${mediaIndex}${extension}`;
          pendingCopies.push(copyZipFile(
            source,
            destination,
            sourcePartPath,
            destinationPartPath
          ));
          return setRelationshipTarget(
            tag,
            `../media/${posix.basename(destinationPartPath)}`
          );
        });
        await Promise.all(pendingCopies);
        destination.file(destinationRelsPath, slideRels);
      }

      const presentationRelId = `rId${nextPresentationRelId}`;
      nextPresentationRelId += 1;
      presentation = presentation.replace(
        "</p:sldIdLst>",
        `<p:sldId id="${nextSlideId}" r:id="${presentationRelId}"/></p:sldIdLst>`
      );
      nextSlideId += 1;
      presentationRels = presentationRels.replace(
        "</Relationships>",
        `<Relationship Id="${presentationRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${destinationSlideNumber}.xml"/></Relationships>`
      );
      contentTypes = addContentTypeOverride(
        contentTypes,
        `/ppt/slides/slide${destinationSlideNumber}.xml`,
        "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"
      );
      slideCount += 1;
    }
  }

  destination.file("ppt/presentation.xml", presentation);
  destination.file("ppt/_rels/presentation.xml.rels", presentationRels);
  destination.file("[Content_Types].xml", contentTypes);
  const appProperties = destination.file("docProps/app.xml");
  if (appProperties) {
    destination.file(
      "docProps/app.xml",
      updateAppProperties(await appProperties.async("string"), slideCount)
    );
  }
  return destination.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
