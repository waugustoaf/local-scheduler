import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
const files = {
  "/": "index.html",
  "/index.html": "index.html",
  "/ui.js": "ui.js",
  "/ui.css": "ui.css",
};
createServer(async (req, res) => {
  const file = files[req.url?.split("?")[0] ?? "/"];
  if (!file) {
    res.writeHead(404).end();
    return;
  }
  try {
    res.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "application/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    res.end(await readFile(join("dist", file)));
  } catch {
    res.writeHead(404).end("Rode npm run build primeiro.");
  }
}).listen(4173, "127.0.0.1", () =>
  console.log("Prévia: http://127.0.0.1:4173"),
);
