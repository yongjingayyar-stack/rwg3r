/* three.js subclass used only by the headless smoke test */
import * as THREE from 'three';
export class MockRenderer {
  constructor() {
    this.domElement = document.getElementById('gl');
    this.shadowMap = { enabled: false, type: 0 };
    this.toneMapping = 0; this.outputColorSpace = '';
    MockRenderer.count++;
  }
  setSize(w, h) { this.w = w; this.h = h; }
  setPixelRatio() {}
  setRenderTarget(rt) { this.rt = rt; }
  clear() {}
  compile() {}
  render(scene, camera) {
    MockRenderer.count2 = (MockRenderer.count2 || 0) + 1;
    scene.traverse?.((o) => {
      if (o.isMesh || o.isPoints || o.isSprite) o.updateWorldMatrix(true, false);
    });
    camera?.updateMatrixWorld?.(true);
  }
}
export { THREE };
