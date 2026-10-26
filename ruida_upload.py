#!/usr/bin/env python3
"""Native Ruida storage transfer. Read-only by default. Never edits FTP indexes."""
import argparse
import hashlib
import ftplib
import io
import time
import json
import re
import socket
from pathlib import Path


def swap07(b):
    return (b & 0x7e) | ((b & 1) << 7) | ((b >> 7) & 1)


def scramble(data):
    return bytes(((swap07(b) ^ 0x88) + 1) & 255 for b in data)


def unscramble(data):
    return bytes(swap07(((b - 1) & 255) ^ 0x88) for b in data)


def frame_udp(payload):
    return (sum(payload) & 0xffff).to_bytes(2, 'big') + payload


def validate_file(data, filename):
    name = filename.strip().upper()
    if not re.fullmatch(r'[A-Z0-9_-]{1,8}\.RD', name):
        raise ValueError('Use 1–8 ASCII letters, digits, _ or -, followed by .RD')
    raw = unscramble(data)
    if not raw.startswith(b'\xe7\x01' + name[:-3].encode('ascii') + b'\0') or not raw.endswith(b'\xd7'):
        raise ValueError('RD file must have a matching embedded filename and final EOF')
    if len(data) > 32 * 1024 * 1024:
        raise ValueError('RD file exceeds 32 MiB')
    return name


def stream_rd_udp(data, ip, port=50201, progress=None):
    """Stop on any absent/invalid ACK. Never retry ambiguous packets or ports.

    Repeating a chunk after a lost ACK can duplicate geometry. The RD stream
    already includes its filename and EOF; neither should be appended again.
    """
    stream = scramble(b'\xe8\x02') + data
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.settimeout(3.0)
        sock.bind(('0.0.0.0', 40200))
        sock.connect((ip, port))
        # This controller must register the UDP client before download preparation.
        sock.send(frame_udp(scramble(b'\xcc')))
        if sock.recv(2048) != scramble(b'\xcc'):
            raise OSError('Controller did not acknowledge the UDP handshake')
        for offset in range(0, len(stream), 1024):
            sock.send(frame_udp(stream[offset:offset + 1024]))
            try:
                response = sock.recv(2048)
            except socket.timeout as exc:
                raise OSError(f'No ACK for packet {offset // 1024 + 1}; transfer state uncertain') from exc
            if response != scramble(b'\xcc'):
                raise OSError(f'Controller rejected packet {offset // 1024 + 1}: {response.hex()}')
            if progress:
                progress(min(len(data), offset + 1024 - 2), len(data))
    return len(data)


def probe_controller(ip, port=50201):
    start = time.monotonic()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.settimeout(3.0)
            sock.bind(('0.0.0.0', 40200))
            sock.connect((ip, port))
            sock.send(frame_udp(scramble(b'\xcc')))
            if sock.recv(2048) != scramble(b'\xcc'):
                raise OSError('Unexpected UDP handshake reply')
        return {'online': True, 'ip': ip, 'port': port, 'transport': 'UDP',
                'latencyMs': round((time.monotonic() - start) * 1000)}
    except OSError as exc:
        return {'online': False, 'ip': ip, 'port': port, 'transport': 'UDP', 'error': str(exc)}


def verify_storage(expected, filename, ip):
    """Read-only FTP check of the exact stored file and optional index entry."""
    try:
        with ftplib.FTP() as ftp:
            ftp.connect(ip, 21, timeout=4)
            ftp.login('anonymous', '')
            ftp.cwd('/driver/workfile')
            actual = None
            for name in [filename + ' ', filename]:
                buf = io.BytesIO()
                try:
                    ftp.retrbinary('RETR ' + name, buf.write)
                    actual = buf.getvalue()
                    break
                except ftplib.error_perm:
                    continue
            if actual is None:
                return {'verification': 'unavailable', 'warning': 'Download acknowledged, but stored file could not be read back. Check the cutter before retrying.'}
            if actual != expected:
                return {'verification': 'mismatch', 'error': 'Stored file differs from sent data. Do not run it; check controller storage.'}
            result = {'verification': 'matched', 'storedBytes': len(actual)}
            try:
                record = io.BytesIO()
                ftp.retrbinary('RETR .filerecord', record.write)
                for line in record.getvalue().decode('latin1').splitlines():
                    parts = line.split(':', 1)
                    if len(parts) == 2 and parts[1].strip().upper() == filename:
                        result['fileIndex'] = int(parts[0])
            except (OSError, ValueError, ftplib.Error):
                pass
            return result
    except (OSError, ftplib.Error) as exc:
        return {'verification': 'unavailable', 'warning': f'Download acknowledged; readback unavailable: {exc}. Check the cutter before retrying.'}


def upload_rd_to_controller(filepath, filename='DEFAULT.RD', ip='192.168.1.11', port=50201, *, allow_write=False, progress=None, verify=False):
    if not allow_write:
        return {'success': False, 'error': 'Read-only mode: controller writes are disabled'}
    try:
        data = Path(filepath).read_bytes()
        name = validate_file(data, filename)
        if not 1 <= port <= 65535:
            raise ValueError('Invalid UDP port')
        sent = stream_rd_udp(data, ip, port, progress=progress)
        verification = verify_storage(data, name, ip) if verify else {'verification': 'not-requested'}
        return {'success': verification['verification'] != 'mismatch', **verification, 'filename': name, 'bytesSent': sent, 'ip': ip, 'port': port, 'sha256': hashlib.sha256(data).hexdigest(), 'transport': 'UDP',
                'message': 'All packets acknowledged; hardware preview/cutting not verified'}
    except (OSError, ValueError) as exc:
        return {'success': False, 'error': str(exc), 'ip': ip}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('filepath', nargs='?')
    p.add_argument('filename', nargs='?', default='DEFAULT.RD')
    p.add_argument('ip', nargs='?', default='192.168.1.11')
    p.add_argument('--port', type=int, default=50201)
    p.add_argument('--allow-write', action='store_true')
    p.add_argument('--probe', action='store_true')
    p.add_argument('--progress', action='store_true')
    p.add_argument('--verify', action='store_true', help='Read back the stored file via FTP; never edits FTP storage')
    args = p.parse_args()
    if args.probe:
        result = probe_controller(args.ip, args.port)
        print(json.dumps(result))
        raise SystemExit(0 if result['online'] else 1)
    if not args.filepath:
        p.error('filepath required for upload')
    def on_progress(sent, total):
        print(json.dumps({'event': 'progress', 'bytesSent': sent, 'totalBytes': total}), flush=True)
    result = upload_rd_to_controller(args.filepath, args.filename, args.ip, args.port,
                                    allow_write=args.allow_write, progress=on_progress if args.progress else None, verify=args.verify)
    print(json.dumps(result), flush=True)
    raise SystemExit(0 if result['success'] else 1)
