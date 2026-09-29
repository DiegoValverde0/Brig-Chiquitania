import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  HttpException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

/**
 * Los errores de body-parser (cuerpo demasiado grande, JSON mal formado) no son HttpException: Nest los
 * registraría como errores internos. Aquí se traducen a la respuesta HTTP que corresponde, sin ruido en el log.
 */
@Catch()
export class FiltroErroresCuerpo extends BaseExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    super.catch(traducir(error), host);
  }
}

function traducir(error: unknown): unknown {
  if (error instanceof HttpException || typeof error !== 'object' || error === null) return error;
  switch ((error as { type?: string }).type) {
    case 'entity.too.large':
      return new PayloadTooLargeException('El cuerpo supera el tamaño permitido (fotos ≤100 KB, JSON ≤16 KB)');
    case 'entity.parse.failed':
      return new BadRequestException('JSON mal formado');
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return new UnsupportedMediaTypeException('Codificación del cuerpo no soportada');
    default:
      return error;
  }
}
