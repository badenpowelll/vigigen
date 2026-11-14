import { test } from "node:test";
import assert from "node:assert/strict";
import { zoomEm, limitar, coresDe, classe } from "../src/componentes/Mapa";

test("zoom mantém o ponto sob o cursor parado", () => {
  const v = zoomEm({ k: 1, x: 0, y: 0 }, 2, 320, 210, 640, 420);
  assert.equal(v.k, 2);
  assert.equal(320 * v.k + v.x, 320);
  assert.equal(210 * v.k + v.y, 210);
});

test("zoom fica entre 1x e 12x e o mapa não sai do quadro", () => {
  assert.equal(zoomEm({ k: 1, x: 0, y: 0 }, 0.1, 0, 0, 640, 420).k, 1);
  assert.equal(zoomEm({ k: 10, x: 0, y: 0 }, 5, 0, 0, 640, 420).k, 12);
  const v = limitar({ k: 2, x: 500, y: -5000 }, 640, 420);
  assert.deepEqual(v, { k: 2, x: 0, y: -420 });
});

test("cada vírus tem a própria rampa de cor; sem paleta, a azul", () => {
  assert.equal(coresDe("zika")[5], "var(--zika-6)");
  assert.equal(coresDe()[0], "var(--mag-1)");
  assert.equal(classe(7, [1, 5, 10]), 2);
});
