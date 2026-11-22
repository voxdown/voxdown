#!/usr/bin/env python3
"""Generate our original fixture with pinned, independently implemented Screenplain.

Uses a temporary venv without pip or product dependencies. The selected upstream
parser/exporter imports only the Python standard library and its own modules.
Network is used only by this explicit maintenance command, never product/tests.
"""

import argparse
import hashlib
import io
import pathlib
import subprocess
import tempfile
import urllib.request
import venv
import zipfile

COMMIT = "abf0d0800ab0b9dfd5bbe780137641e746afbad4"
SHA256 = "be2ac69918cad31b9920ae3a4e9779ce6be1a5c0c4e2331c6005a7ac93bbf705"
URL = f"https://codeload.github.com/vilcans/screenplain/zip/{COMMIT}"
FIXTURES = pathlib.Path(__file__).resolve().parents[1] / "site/test/fixtures/studio-interop"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Compare without changing fixtures")
    args = parser.parse_args()
    with urllib.request.urlopen(URL, timeout=30) as response:
        archive = response.read(5_000_001)
    if len(archive) > 5_000_000 or hashlib.sha256(archive).hexdigest() != SHA256:
        raise RuntimeError("Pinned Screenplain source archive checksum mismatch")
    with tempfile.TemporaryDirectory(prefix="voxdown-screenplain-") as directory:
        temp = pathlib.Path(directory)
        source = temp / "producer"
        prefix = f"screenplain-{COMMIT}/"
        # Extract only regular Python source files from the pinned package, with
        # traversal checks. Do not install its optional PDF/CLI dependencies.
        with zipfile.ZipFile(io.BytesIO(archive)) as package:
            for member in package.infolist():
                if not member.filename.startswith(prefix + "screenplain/"):
                    continue
                relative = pathlib.PurePosixPath(member.filename[len(prefix):])
                if ".." in relative.parts or relative.is_absolute() or relative.suffix != ".py":
                    continue
                target = source.joinpath(*relative.parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(package.read(member))
        environment = temp / "venv"
        venv.EnvBuilder(with_pip=False).create(environment)
        generated = temp / "lantern.screenplain.fdx"
        # -I isolates environment variables and user site packages; only the
        # verified source directory is added explicitly to this fresh process.
        subprocess.run(
            [str(environment / "bin/python"), "-I", "-c", """
import io, pathlib, sys, xml.etree.ElementTree as ET
sys.path.insert(0, sys.argv[1])
from screenplain.parsers.fountain import parse
from screenplain.export.fdx import to_fdx
screenplay = parse(io.StringIO(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8')))
output = io.StringIO()
to_fdx(screenplay, output)
xml = output.getvalue()
root = ET.fromstring(xml)
assert root.tag == 'FinalDraft' and len(root.findall('.//DualDialogue')) == 1
assert 'PRIVATE_' not in xml and 'fixture-contact' not in xml
pathlib.Path(sys.argv[3]).write_bytes(xml.encode('utf-8'))
""", str(source), str(FIXTURES / "lantern.fountain"), str(generated)],
            check=True, timeout=30,
        )
        target = FIXTURES / generated.name
        if args.check:
            if target.read_bytes() != generated.read_bytes():
                raise RuntimeError("Fixture differs: rerun without --check and review the change")
            print("Pinned Screenplain 0.12.0 fixture matches byte for byte")
        else:
            target.write_bytes(generated.read_bytes())
            print(f"Generated {target}")


if __name__ == "__main__":
    main()
