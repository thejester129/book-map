// Local dev server: rebuilds dist/index.html when src/ changes and reloads the browser.
// Usage: node dev.js [port]   (or ./start.sh)
const fs = require("fs");
const http = require("http");
const path = require("path");

const port = Number(process.argv[2] || process.env.PORT || 8000);
const page = path.join(__dirname, "dist/index.html");
const clients = new Set();

// Injected before </body> so the page reloads itself after each rebuild.
const reloadScript = `<script>new EventSource("/__reload").onmessage = () => location.reload();</script>`;

function rebuild() {
  try {
    // Re-require so edits to build.js apply without restarting.
    delete require.cache[require.resolve("./build")];
    require("./build")();
    for (const res of clients) res.write("data: reload\n\n");
  } catch (err) {
    console.error("Build failed:", err.message);
  }
}

rebuild();

let timer;
for (const p of ["src", "build.js"]) fs.watch(path.join(__dirname, p), () => {
  clearTimeout(timer);
  timer = setTimeout(rebuild, 100);
});

http.createServer((req, res) => {
  if (req.url === "/__reload") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write("\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  if (req.url !== "/" && !req.url.startsWith("/?") && req.url !== "/index.html") {
    res.writeHead(404).end("Not found");
    return;
  }
  const html = fs.readFileSync(page, "utf8").replace("</body>", `${reloadScript}</body>`);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(html);
}).listen(port, () => console.log(`BookMap dev server at http://localhost:${port} (watching src/)`));
