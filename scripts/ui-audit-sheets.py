"""Build review sheets from browser evidence; never modifies product assets."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


def build(root, target, ledger):
    target.mkdir(parents=True, exist_ok=True)
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
    groups = {}
    review = json.loads(ledger.read_text()) if ledger.exists() else {'digests': [], 'parts': {}, 'cases': {}}
    for path in sorted(root.rglob('*.png')):
        metadata = path.with_suffix('.json')
        if not metadata.exists():
            continue
        data = json.loads(metadata.read_text())
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        relative = str(path.relative_to(root))
        if digest in review['digests']:
            review['cases'][relative] = digest
            continue
        if digest in groups:
            groups[digest]['aliases'].append(relative)
            continue
        groups[digest] = {'path': path, 'data': data, 'aliases': [relative]}
    tiles = {'desktop': [], 'mobile': []}
    for digest, group in groups.items():
        path, data = group['path'], group['data']
        mode = 'mobile' if data['viewport']['width'] < 768 else 'desktop'
        width = 320 if mode == 'mobile' else 640
        with Image.open(path) as original:
            picture = original.convert('RGB')
            height = round(picture.height * width / picture.width)
            picture = picture.resize((width, height), Image.Resampling.LANCZOS)
        for start in range(0, height, 760):
            part = picture.crop((0, start, width, min(start + 760, height)))
            tile = Image.new('RGB', (width, part.height + 44), '#e8eef0')
            draw = ImageDraw.Draw(tile)
            label = f"{path.stem} | {data['viewport']['width']}x{data['viewport']['height']} | part {start // 760 + 1}"
            draw.text((10, 5), label[:42 if mode == 'mobile' else 86], font=font, fill='#071c20')
            draw.text((10, 22), f"{data['viewport']['width']}x{data['viewport']['height']} | part {start // 760 + 1}", font=font, fill='#395158')
            tile.paste(part, (0, 44))
            tiles[mode].append((tile, {'source': str(path), 'digest': digest, 'aliases': group['aliases'], 'part': start // 760 + 1, 'total': (height + 759) // 760}))
    manifest = []
    for mode, items in tiles.items():
        columns = 4 if mode == 'mobile' else 2
        rows, y, frames = [], 0, []
        def flush():
            nonlocal rows, y, frames
            if not rows: return
            sheet = Image.new('RGB', (1280, y), 'white')
            for tile, x, top in rows: sheet.paste(tile, (x, top))
            name = f'{mode}-{len(manifest) + 1:03}.jpg'
            sheet.save(target / name, quality=90)
            manifest.append({'sheet': name, 'frames': frames})
            rows, y, frames = [], 0, []
        for offset in range(0, len(items), columns):
            batch = items[offset:offset + columns]
            row_height = max(tile.height for tile, _ in batch)
            if y + row_height > 1680: flush()
            for index, (tile, frame) in enumerate(batch):
                rows.append((tile, index * (1280 // columns), y))
                frames.append(frame)
            y += row_height
        flush()
    (target / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    ledger.write_text(json.dumps(review, indent=2))
    print(json.dumps({'unique_unreviewed_images': len(groups), 'sheets': len(manifest), 'previously_reviewed_cases': len(review['cases'])}))


def mark(target, ledger, names):
    review = json.loads(ledger.read_text())
    manifest = json.loads((target / 'manifest.json').read_text())
    for sheet in manifest:
        if sheet['sheet'] not in names: continue
        for frame in sheet['frames']:
            parts = set(review['parts'].get(frame['digest'], []))
            parts.add(frame['part'])
            review['parts'][frame['digest']] = sorted(parts)
            if len(parts) == frame['total']:
                if frame['digest'] not in review['digests']: review['digests'].append(frame['digest'])
                for alias in frame['aliases']: review['cases'][alias] = frame['digest']
    ledger.write_text(json.dumps(review, indent=2))
    print(json.dumps({'reviewed_unique_images': len(review['digests']), 'reviewed_cases': len(review['cases'])}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('root', type=Path)
    parser.add_argument('target', type=Path)
    parser.add_argument('--ledger', type=Path, default=Path('/tmp/ui-audit-review.json'))
    parser.add_argument('--review', nargs='+')
    arguments = parser.parse_args()
    if arguments.review: mark(arguments.target, arguments.ledger, arguments.review)
    else: build(arguments.root, arguments.target, arguments.ledger)
