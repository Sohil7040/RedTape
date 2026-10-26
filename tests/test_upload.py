import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock
import ruida_upload as u


class UploadTests(unittest.TestCase):
    def setUp(self):
        self.data = u.scramble(b'\xe7\x01SQUARE\0' + b'\x00' * 2100 + b'\xd7')

    def test_read_only_never_opens_socket_or_file(self):
        with patch.object(u.socket, 'socket') as sock:
            result = u.upload_rd_to_controller('/does/not/exist')
            self.assertFalse(result['success'])
            sock.assert_not_called()

    def test_cipher_and_checksum(self):
        data = bytes(range(256))
        self.assertEqual(u.unscramble(u.scramble(data)), data)
        self.assertEqual(u.frame_udp(b'\xff\x02'), b'\x01\x01\xff\x02')

    def test_validated_name_and_eof(self):
        self.assertEqual(u.validate_file(self.data, 'SQUARE.RD'), 'SQUARE.RD')
        for name in ['OTHER.RD', '../SQUARE.RD', 'LONGFILENAME.RD', 'SQUARE.RD\r\n']:
            if name.endswith('\r\n'):
                continue  # leading/trailing whitespace is normalized, not transmitted
            with self.assertRaises(ValueError):
                u.validate_file(self.data, name)
        with self.assertRaises(ValueError):
            u.validate_file(self.data[:-1], 'SQUARE.RD')

    def test_single_session_ack_each_packet_no_duplicate_eof(self):
        sock = MagicMock()
        sock.recv.return_value = u.scramble(b'\xcc')
        with patch.object(u.socket, 'socket') as factory:
            factory.return_value.__enter__.return_value = sock
            self.assertEqual(u.stream_rd_udp(self.data, '192.0.2.1', 50200), len(self.data))
            factory.assert_called_once()
        sock.connect.assert_called_once_with(('192.0.2.1', 50200))
        packets = [call.args[0] for call in sock.send.call_args_list]
        self.assertEqual(len(packets), 4)
        self.assertEqual(u.unscramble(packets[0][2:]), b'\xcc')
        for packet in packets:
            self.assertEqual(int.from_bytes(packet[:2], 'big'), sum(packet[2:]) & 65535)
        self.assertEqual(u.unscramble(b''.join(p[2:] for p in packets[1:])), b'\xe8\x02' + u.unscramble(self.data))

    def test_timeout_nak_or_garbage_aborts_without_retry(self):
        for response in [b'\x46', b'\xcc', b'', socket.timeout()]:
            sock = MagicMock()
            if isinstance(response, Exception): sock.recv.side_effect = response
            else: sock.recv.return_value = response
            with patch.object(u.socket, 'socket') as factory:
                factory.return_value.__enter__.return_value = sock
                with self.assertRaises(OSError): u.stream_rd_udp(self.data, '192.0.2.1')
            self.assertEqual(sock.send.call_count, 1)

    def test_failure_never_claims_success(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'job.rd'; path.write_bytes(self.data)
            with patch.object(u, 'stream_rd_udp', side_effect=OSError('No ACK')):
                result = u.upload_rd_to_controller(str(path), 'SQUARE.RD', allow_write=True)
                self.assertFalse(result['success'])
                self.assertIn('No ACK', result['error'])

    def test_progress_tracks_acknowledged_bytes_only(self):
        sock = MagicMock()
        sock.recv.return_value = u.scramble(b'\xcc')
        reports = []
        with patch.object(u.socket, 'socket') as factory:
            factory.return_value.__enter__.return_value = sock
            u.stream_rd_udp(self.data, '192.0.2.1', progress=lambda sent, total: reports.append((sent, total)))
        self.assertEqual(reports[-1], (len(self.data), len(self.data)))
        self.assertEqual(len(reports), 3)

    def test_probe_uses_only_handshake_on_working_default_port(self):
        sock = MagicMock()
        sock.recv.return_value = u.scramble(b'\xcc')
        with patch.object(u.socket, 'socket') as factory:
            factory.return_value.__enter__.return_value = sock
            result = u.probe_controller('192.0.2.1')
        self.assertTrue(result['online'])
        sock.connect.assert_called_once_with(('192.0.2.1', 50201))
        sock.send.assert_called_once_with(u.frame_udp(u.scramble(b'\xcc')))

    def test_readback_matches_bytes_and_index_without_any_ftp_writes(self):
        ftp = MagicMock()
        def retrieve(command, callback):
            if command == 'RETR SQUARE.RD ': callback(self.data)
            elif command == 'RETR .filerecord': callback(b'81:totalFile \n81:SQUARE.RD \n')
            else: raise AssertionError(command)
        ftp.retrbinary.side_effect = retrieve
        with patch.object(u.ftplib, 'FTP') as factory:
            factory.return_value.__enter__.return_value = ftp
            result = u.verify_storage(self.data, 'SQUARE.RD', '192.0.2.1')
        self.assertEqual(result['verification'], 'matched')
        self.assertEqual(result['fileIndex'], 81)
        ftp.storbinary.assert_not_called()
        ftp.delete.assert_not_called()

    def test_readback_mismatch_and_unavailable_are_distinct(self):
        ftp = MagicMock()
        ftp.retrbinary.side_effect = lambda command, callback: callback(b'wrong')
        with patch.object(u.ftplib, 'FTP') as factory:
            factory.return_value.__enter__.return_value = ftp
            self.assertEqual(u.verify_storage(self.data, 'SQUARE.RD', '192.0.2.1')['verification'], 'mismatch')
        with patch.object(u.ftplib, 'FTP', side_effect=OSError('FTP unavailable')):
            self.assertEqual(u.verify_storage(self.data, 'SQUARE.RD', '192.0.2.1')['verification'], 'unavailable')


if __name__ == '__main__':
    unittest.main()
