import * as THREE from 'three';

export interface FloorTextureSet {
  albedoMap: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
}

export function createArenaFloorTextures(maxAnisotropy: number): FloorTextureSet {
  const size = 512;

  // 1. Albedo Map
  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = size;
  albedoCanvas.height = size;
  const aCtx = albedoCanvas.getContext('2d')!;
  aCtx.fillStyle = '#0b1120';
  aCtx.fillRect(0, 0, size, size);

  // Sub-grid metallic plating
  aCtx.strokeStyle = '#17233b';
  aCtx.lineWidth = 2;
  const subStep = size / 4;
  for (let i = 0; i <= 4; i++) {
    const pos = i * subStep;
    aCtx.beginPath();
    aCtx.moveTo(pos, 0);
    aCtx.lineTo(pos, size);
    aCtx.stroke();

    aCtx.beginPath();
    aCtx.moveTo(0, pos);
    aCtx.lineTo(size, pos);
    aCtx.stroke();
  }

  // Diagonal tech bevel accents
  aCtx.strokeStyle = '#1e293b';
  aCtx.lineWidth = 3;
  aCtx.strokeRect(10, 10, size - 20, size - 20);

  // Primary border seam
  aCtx.strokeStyle = '#0ea5e9';
  aCtx.lineWidth = 3;
  aCtx.strokeRect(1.5, 1.5, size - 3, size - 3);

  const albedoMap = new THREE.CanvasTexture(albedoCanvas);
  albedoMap.colorSpace = THREE.SRGBColorSpace;
  albedoMap.wrapS = THREE.RepeatWrapping;
  albedoMap.wrapT = THREE.RepeatWrapping;
  albedoMap.repeat.set(24, 24);
  albedoMap.anisotropy = maxAnisotropy;

  // 2. Emissive Map
  const emissiveCanvas = document.createElement('canvas');
  emissiveCanvas.width = size;
  emissiveCanvas.height = size;
  const eCtx = emissiveCanvas.getContext('2d')!;
  eCtx.fillStyle = '#000000';
  eCtx.fillRect(0, 0, size, size);

  // Subtle cyan circuit traces
  eCtx.strokeStyle = '#0284c7';
  eCtx.lineWidth = 2;
  eCtx.strokeRect(1.5, 1.5, size - 3, size - 3);

  // Corner node highlights
  eCtx.fillStyle = '#38bdf8';
  const nodeSize = 8;
  eCtx.fillRect(0, 0, nodeSize, nodeSize);
  eCtx.fillRect(size - nodeSize, 0, nodeSize, nodeSize);
  eCtx.fillRect(0, size - nodeSize, nodeSize, nodeSize);
  eCtx.fillRect(size - nodeSize, size - nodeSize, nodeSize, nodeSize);

  // Center cross reticle
  eCtx.strokeStyle = '#0369a1';
  eCtx.lineWidth = 1.5;
  eCtx.beginPath();
  eCtx.moveTo(size / 2 - 16, size / 2);
  eCtx.lineTo(size / 2 + 16, size / 2);
  eCtx.moveTo(size / 2, size / 2 - 16);
  eCtx.lineTo(size / 2, size / 2 + 16);
  eCtx.stroke();

  const emissiveMap = new THREE.CanvasTexture(emissiveCanvas);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  emissiveMap.wrapS = THREE.RepeatWrapping;
  emissiveMap.wrapT = THREE.RepeatWrapping;
  emissiveMap.repeat.set(24, 24);
  emissiveMap.anisotropy = maxAnisotropy;

  // 3. Roughness Map (Linear data map)
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;
  rCtx.fillStyle = '#404040'; // Fairly reflective base metal (roughness ~0.25)
  rCtx.fillRect(0, 0, size, size);

  rCtx.fillStyle = '#686868'; // Slightly rougher inner plate
  rCtx.fillRect(28, 28, size - 56, size - 56);

  rCtx.strokeStyle = '#181818'; // Glossy seams
  rCtx.lineWidth = 6;
  rCtx.strokeRect(3, 3, size - 6, size - 6);

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(24, 24);
  roughnessMap.anisotropy = maxAnisotropy;

  // 4. Bump Map (Linear data map)
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bCtx = bumpCanvas.getContext('2d')!;
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, size, size);

  bCtx.strokeStyle = '#303030';
  bCtx.lineWidth = 4;
  bCtx.strokeRect(2, 2, size - 4, size - 4);
  for (let i = 1; i < 4; i++) {
    const pos = i * subStep;
    bCtx.beginPath();
    bCtx.moveTo(pos, 0);
    bCtx.lineTo(pos, size);
    bCtx.moveTo(0, pos);
    bCtx.lineTo(size, pos);
    bCtx.stroke();
  }

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.colorSpace = THREE.NoColorSpace;
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(24, 24);
  bumpMap.anisotropy = maxAnisotropy;

  return { albedoMap, emissiveMap, roughnessMap, bumpMap };
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    4,
    size / 2,
    size / 2,
    size / 2
  );
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.32)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createNebulaTexture(colorHex: string): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    8,
    size / 2,
    size / 2,
    size / 2
  );
  grad.addColorStop(0, colorHex);
  grad.addColorStop(0.45, colorHex + '55');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
