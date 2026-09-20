import { clampLimit, likeTerm } from './search-term';

/**
 * The two decisions every entity picker's endpoint makes, in one place so they cannot drift.
 */
describe('search-term', () => {
  describe('likeTerm', () => {
    it('envuelve el término en comodines', () => {
      expect(likeTerm('ferre')).toBe('%ferre%');
    });

    it('neutraliza los comodines que trae el propio término', () => {
      //  Sin esto, buscar «100%» devuelve la tabla entera y «a_b» encuentra «axb».
      expect(likeTerm('100%')).toBe('%100\\%%');
      expect(likeTerm('a_b')).toBe('%a\\_b%');
      expect(likeTerm('c:\\ruta')).toBe('%c:\\\\ruta%');
    });

    it('trata el espacio en blanco como ausencia de término', () => {
      expect(likeTerm('   ')).toBeNull();
      expect(likeTerm('')).toBeNull();
      expect(likeTerm(undefined)).toBeNull();
      expect(likeTerm(null)).toBeNull();
    });

    it('recorta los extremos', () => {
      expect(likeTerm('  ferre  ')).toBe('%ferre%');
    });
  });

  describe('clampLimit', () => {
    it('acepta un tope razonable', () => {
      expect(clampLimit('50')).toBe(50);
      expect(clampLimit(50)).toBe(50);
    });

    it('no deja pedir la tabla entera ni cero filas', () => {
      expect(clampLimit('1000000')).toBe(200);
      expect(clampLimit('0')).toBe(1);
      expect(clampLimit('-5')).toBe(1);
    });

    it('sin tope pedido, no impone ninguno', () => {
      //  Es el comportamiento que esperan los llamantes anteriores a los selectores.
      expect(clampLimit(undefined)).toBeUndefined();
      expect(clampLimit('')).toBeUndefined();
      expect(clampLimit('muchas')).toBeUndefined();
    });
  });
});
