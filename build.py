#!/usr/bin/env python3
"""src/ の各ファイルを1つの単一HTMLにまとめる。使い方: python3 build.py index.html"""
import sys, pathlib, re
root = pathlib.Path(__file__).parent
order = ["model.js", "drumsynth.js", "render.js", "omr.js", "samples.js", "audio.js", "ui_core.js", "ui_dock.js", "ui_edit.js", "ui_import.js", "ui_io.js"]
js = "\n\n".join((root / "src" / n).read_text(encoding="utf-8") for n in order)
# Node用の module.exports ブロックはブラウザでは不要(typeof module で守っているが、念のため取り除く)
js = re.sub(r"\nif \(typeof module !== \"undefined\"\) \{.*?\n\}\n", "\n", js, flags=re.S)
html = (root / "src" / "template.html").read_text(encoding="utf-8").replace("/*__SCRIPT__*/", js.replace("</script>", "<\\/script>"))
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else root / "index.html")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html, encoding="utf-8")
print("wrote", out, len(html), "bytes")
