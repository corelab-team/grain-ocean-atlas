"""Build the standalone export page and its local resources."""
from pathlib import Path
import json
import shutil
import build_dist

source = Path(build_dist.ROOT)
output = source.parent / "dist" / "export-only"
output.mkdir(parents=True, exist_ok=True)
intermediate = source / "dist" / "export-only.html"
build_dist.main(theme="navy", out_path=str(intermediate), entry="index.html", max_mb=10)
shutil.copyfile(intermediate, output / "index.html")
files = json.loads(Path(str(intermediate) + ".assets.json").read_text(encoding="utf-8"))
for relative in files:
    destination = output / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(intermediate.parent / relative, destination)
(output / "assets-manifest.json").write_text(json.dumps(files), encoding="utf-8")
print("Export-only bundle:", output)
