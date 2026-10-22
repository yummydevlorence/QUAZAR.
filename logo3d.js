import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const box = document.querySelector('.hero-art');
const logo = box?.querySelector('img');

if (box && logo) {
  try {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0f2e22, 8.0, 8.9);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.z = 8;

    const group = new THREE.Group();
    group.rotation.set(0.08, -0.24, 0);
    scene.add(group);

    const texture = new THREE.TextureLoader().load(logo.src, () => {
      texture.colorSpace = THREE.SRGBColorSpace;
      const height = 3.2;
      const width = height * (texture.image.width / texture.image.height);
      const geometry = new THREE.PlaneGeometry(width, height);
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = texture.image.width;
      maskCanvas.height = texture.image.height;
      const context = maskCanvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Could not create the logo depth mask.');
      context.drawImage(texture.image, 0, 0);
      const pixels = context.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const alpha = pixels.data[i + 3];
        pixels.data[i] = alpha;
        pixels.data[i + 1] = alpha;
        pixels.data[i + 2] = alpha;
        pixels.data[i + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      const mask = new THREE.CanvasTexture(maskCanvas);
      mask.colorSpace = THREE.NoColorSpace;

      const layers = 40;
      const depth = 0.6;

      for (let i = 0; i < layers - 1; i++) {
        const ratio = i / (layers - 2);
        const color = new THREE.Color('#0a3324').lerp(new THREE.Color('#2f8f63'), ratio);
        const material = new THREE.MeshBasicMaterial({
          alphaMap: mask,
          transparent: true,
          alphaTest: 0.25,
          color,
          side: THREE.DoubleSide,
          depthWrite: true
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.z = -depth + ratio * depth;
        group.add(mesh);
      }

      const front = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          map: texture,
          color: 0xbfe8d2,
          transparent: true,
          alphaTest: 0.25,
          side: THREE.DoubleSide
        })
      );
      front.position.z = 0.001;
      group.add(front);

      box.replaceChildren(renderer.domElement);
      resize();
      animate();
    }, undefined, (error) => {
      console.error('Could not load the QuazarTech logo texture.', error);
    });

    const pointer = { x: 0, y: 0 };
    window.addEventListener('pointermove', (event) => {
      pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
    });

    function resize() {
      const width = box.clientWidth;
      const height = box.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clock = new THREE.Clock();

    function animate() {
      requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const m = reduceMotion ? 0 : 1;
      const targetY = -0.24 + Math.sin(t * 0.8) * 0.35 * m + pointer.x * 0.25;
      const targetX = 0.08 + Math.sin(t * 0.6) * 0.06 * m + pointer.y * 0.12;
      group.rotation.y += (targetY - group.rotation.y) * 0.06;
      group.rotation.x += (targetX - group.rotation.x) * 0.06;
      group.position.y = Math.sin(t * 1.2) * 0.08 * m;
      renderer.render(scene, camera);
    }

    new ResizeObserver(resize).observe(box);
  } catch (error) {
    console.error('Failed to initialize the 3D logo effect.', error);
  }
}
