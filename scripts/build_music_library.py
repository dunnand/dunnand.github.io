#!/usr/bin/env python
"""
Rebuilds images/music_library.json - the dataset behind music.html's search
page - from two nightly-refreshed sources:
  - metadata_cache.json (WCYT Album Art Nightly): a direct WAV-tag scan of
    the actual station library (W:/U:/X: drives), so it's always current.
  - song_facts.json (WCYT Song Facts Nightly): KEXP-style trivia, keyed
    "artist|title" lowercased (see art_common.song_key).

This replaces music.html's old data source, a Google Sheet that stopped
being updated after 2026-07-20.

Run nightly via Task Scheduler ("WCYT Music Library Nightly"), scheduled
after both source tasks finish (Song Facts ~00:00, Album Art ~02:00-02:10).
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(r'C:\Users\Andy\Documents')))
from art_common import norm, norm_artist, song_key  # noqa: E402 - shared normalization, must not drift

METADATA_CACHE = Path(r'C:\Users\Andy\Desktop\album_art_review\metadata_cache.json')
SONG_FACTS     = Path(r'C:\Users\Andy\WCYT-Website\images\song_facts.json')
OUT_FILE       = Path(r'C:\Users\Andy\WCYT-Website\images\music_library.json')

# Mirrors WCYT_CANDIDATES / PT20_CANDIDATES in download_album_art.py.
WCYT_PREFIXES = ('w:\\', 'u:\\wcyt music', '\\\\wcyt\\wcyt music')
PT20_PREFIXES = ('x:\\', 'u:\\2point0 music', '\\\\2point0\\music')


def strip_simian(s):
    return re.sub(r'\s*<[A-Za-z]+>[^<]*<[A-Za-z]+>', '', s or '').strip()


def station_for(path):
    p = path.lower()
    if p.startswith(WCYT_PREFIXES):
        return 'WCYT'
    if p.startswith(PT20_PREFIXES):
        return '2.0'
    return ''


def extract(path, meta):
    """Mirrors the artist/title/album/year precedence in download_album_art.py
    (scan_wav_folder) so keys line up with the rest of the art pipeline."""
    artist = meta.get('IART', '').split('\x00')[0].strip()
    title = strip_simian(
        meta.get('tttl', '').split('\x00')[0].strip()
        or meta.get('bext_desc', '').strip()
        or meta.get('disp', '').strip()
        or re.sub(r'\s*\(\d{4}\)\s*$', '', meta.get('INAM', '').split('\x00')[0]).strip()
    )
    album = meta.get('IALB', '').split('\x00')[0].strip()
    year = meta.get('IYER', '').strip()[:4]
    return artist, title, album, year


def load_songs():
    cache = json.loads(METADATA_CACHE.read_text('utf-8'))
    songs = {}
    for path, meta in cache.items():
        artist, title, album, year = extract(path, meta)
        if not artist or not title:
            continue
        station = station_for(path)
        key = (norm_artist(artist), norm(title))
        rec = songs.get(key)
        if rec is None:
            songs[key] = {
                'artist': artist, 'title': title, 'album': album, 'year': year,
                'stations': {station} if station else set(),
            }
        else:
            if not rec['album'] and album:
                rec['album'] = album
            if not rec['year'] and year:
                rec['year'] = year
            if station:
                rec['stations'].add(station)
    return songs


def load_facts():
    try:
        data = json.loads(SONG_FACTS.read_text('utf-8-sig'))
    except Exception:
        return {}
    return data.get('overrides', {})


def main():
    songs = load_songs()
    facts = load_facts()

    out = []
    fact_hits = 0
    for rec in songs.values():
        k = song_key(rec['artist'], rec['title'])
        fact = facts.get(k)
        if fact:
            fact_hits += 1
        stations = rec['stations']
        station = 'Both' if len(stations) > 1 else (next(iter(stations)) if stations else '')
        out.append({
            'artist': rec['artist'],
            'title': rec['title'],
            'album': rec['album'],
            'year': int(rec['year']) if rec['year'].isdigit() else None,
            'station': station,
            'fact': fact.get('fact') if fact else None,
            'source': fact.get('source') if fact else None,
        })

    out.sort(key=lambda s: (s['artist'].lower(), s['title'].lower()))
    OUT_FILE.write_text(json.dumps(out, indent=0, ensure_ascii=False), 'utf-8')
    print(f'Wrote {len(out)} songs to {OUT_FILE} ({fact_hits} with facts attached).')


if __name__ == '__main__':
    main()
