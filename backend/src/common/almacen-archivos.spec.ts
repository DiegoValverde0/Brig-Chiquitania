import { detectarTipo } from './almacen-archivos.service';

describe('detectarTipo (por firma de bytes, no por Content-Type)', () => {
  it('reconoce PDF, JPEG, PNG y WebP', () => {
    expect(detectarTipo(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
    expect(detectarTipo(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectarTipo(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(detectarTipo(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
  });

  it('rechaza lo demás (texto, HTML, un PDF truncado)', () => {
    expect(detectarTipo(Buffer.from('hola'))).toBeNull();
    expect(detectarTipo(Buffer.from('<html>%PDF-'))).toBeNull();
    expect(detectarTipo(Buffer.from('%PDF'))).toBeNull();
  });
});
