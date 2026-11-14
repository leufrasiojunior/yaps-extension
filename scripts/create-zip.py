import os
import zipfile

root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dist_dir = os.path.join(root_dir, "dist")
zip_path = os.path.join(dist_dir, "yapd-extension.zip")

if os.path.exists(zip_path):
    os.remove(zip_path)

with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(dist_dir):
        for file in files:
            if file.endswith(".zip"):
                continue
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, dist_dir)
            z.write(full_path, rel_path)

print(f"✓ Pacote gerado com sucesso: {zip_path} ({os.path.getsize(zip_path)} bytes)")

# Copia para apps/web/public/downloads/yapd-extension.zip
yapd_downloads = os.path.join(os.path.dirname(root_dir), "yadp", "apps", "web", "public", "downloads")
os.makedirs(yapd_downloads, exist_ok=True)
dest = os.path.join(yapd_downloads, "yapd-extension.zip")
with open(zip_path, "rb") as fsrc, open(dest, "wb") as fdst:
    fdst.write(fsrc.read())
print(f"✓ Pacote copiado para o container do YAPD em: {dest}")
