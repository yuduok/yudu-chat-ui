import assert from "node:assert/strict";
import test from "node:test";
import { attachmentFromBuffer } from "../src/routes/uploads.js";

test("image uploads become named data URL content parts", async () => {
  const attachment = await attachmentFromBuffer({
    filename: "pixel.png",
    mimetype: "image/png",
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  });
  assert.equal(attachment.type, "image_url");
  if (attachment.type !== "image_url") return;
  assert.equal(attachment.name, "pixel.png");
  assert.match(attachment.image_url.url, /^data:image\/png;base64,/);
});

test("spoofed image MIME types are rejected", async () => {
  await assert.rejects(
    attachmentFromBuffer({
      filename: "fake.png",
      mimetype: "image/png",
      buffer: Buffer.from("not a png"),
    }),
    /does not match its MIME type/,
  );
});

test("text documents become extracted document content parts", async () => {
  const attachment = await attachmentFromBuffer({
    filename: "notes.md",
    mimetype: "text/markdown",
    buffer: Buffer.from("# Notes\n\nhello", "utf8"),
  });
  assert.deepEqual(attachment, {
    type: "document",
    name: "notes.md",
    mimeType: "text/markdown",
    size: 14,
    text: "# Notes\n\nhello",
  });
});

test("unsupported binary documents are rejected", async () => {
  await assert.rejects(
    attachmentFromBuffer({
      filename: "archive.zip",
      mimetype: "application/zip",
      buffer: Buffer.from("PK"),
    }),
    /unsupported attachment type/,
  );
});

test("text document type can be inferred when browsers omit MIME", async () => {
  const attachment = await attachmentFromBuffer({
    filename: "readme.md",
    mimetype: "",
    buffer: Buffer.from("hello", "utf8"),
  });
  assert.equal(attachment.type, "document");
  if (attachment.type === "document") assert.equal(attachment.mimeType, "text/markdown");
});
