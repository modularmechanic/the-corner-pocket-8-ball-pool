import * as THREE from 'three';
import { canvasTexture, woodTexture } from './materials';
import { countPubDraws } from './pub-batching';
import { pubResources } from './pub-models';
import { seededRandom } from '../simulation/types';
import type { PropInstaller } from './asset-installer';

export const PUB_CLUB_DECOR = {
  posters: [
    { z: -6.72, y: 0.65 },
    { z: 7.4, y: 1.25 },
  ],
  trophies: { z: 0.62, y: 0.22, width: 2.8 },
  neons: {
    front: { x: 5.66, y: 5.38, width: 3.7, height: 0.73 },
    left: { z: -6.72, y: 4.55, width: 2.15, height: 0.8 },
  },
} as const;
/** Prop paths relative to public/, one Blender-authored model per wall. */
export const PUB_CLUB_DECOR_PROPS = {
  left: 'models/pub/club-decor-left.glb',
  right: 'models/pub/club-decor-right.glb',
  front: 'models/pub/club-decor-front.glb',
} as const;

function clubPrints() {
  const random = seededRandom('corner-pocket-aged-club-posters');
  return canvasTexture(1024, 1024, (ctx) => {
    for (let poster = 0; poster < 2; poster++) {
      const x = poster * 512;
      ctx.fillStyle = poster ? '#233c38' : '#e1cfa8';
      ctx.fillRect(x, 0, 512, 768);
      for (let i = 0; i < 1700; i++) {
        ctx.fillStyle = random() > 0.5 ? '#6a462416' : '#fff1c214';
        ctx.fillRect(x + random() * 512, random() * 768, 1 + random() * 5, 1 + random() * 3);
      }
      ctx.strokeStyle = poster ? '#b8a56a' : '#4c5140';
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 23, 23, 466, 720);
      ctx.textAlign = 'center';
      ctx.fillStyle = poster ? '#e7d7ac' : '#32453d';
      ctx.font = '22px Georgia';
      ctx.fillText('THE CORNER POCKET', x + 256, 76);
      ctx.font = 'italic 36px Georgia';
      ctx.fillText(poster ? 'The best seat' : 'Make a night of it', x + 256, 153);
      ctx.font = 'bold 67px Georgia';
      ctx.fillText(poster ? 'LIVE' : 'TUESDAY', x + 256, 250);
      ctx.fillText(poster ? 'SPORT' : 'EIGHTS', x + 256, 326);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 82, 363);
      ctx.lineTo(x + 430, 363);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + 256, 458, 61, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = poster ? '#233c38' : '#e1cfa8';
      ctx.beginPath();
      ctx.arc(x + 256, 458, 31, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = poster ? '#e7d7ac' : '#32453d';
      ctx.font = 'bold 35px Georgia';
      ctx.fillText('8', x + 256, 471);
      ctx.font = '27px Georgia';
      ctx.fillText(poster ? 'FOOTBALL  ·  RUGBY' : 'DOUBLES & GOOD COMPANY', x + 256, 574);
      ctx.font = '19px Georgia';
      ctx.fillText(poster ? 'Cold drinks. Close games.' : 'Every Tuesday · From seven', x + 256, 625);
      ctx.font = 'italic 18px Georgia';
      ctx.fillText('Your local, since 1928', x + 256, 695);
      // A few folded edges and rubbed ink make a printed poster, not a UI card.
      ctx.strokeStyle = poster ? '#fff2ca12' : '#44352216';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 12, 194);
      ctx.lineTo(x + 503, 202);
      ctx.moveTo(x + 334, 7);
      ctx.lineTo(x + 325, 757);
      ctx.stroke();
    }
    const labels = [
      ['CLUB CHAMPIONS', '1998'],
      ['THE CAPTAIN’S CUP', 'DOUBLES LEAGUE'],
      ['CHARITY OPEN', 'WINNERS'],
    ];
    for (let i = 0; i < labels.length; i++) {
      const x = i * 340;
      ctx.fillStyle = '#b59150';
      ctx.fillRect(x, 808, 340, 164);
      ctx.fillStyle = '#30291e';
      ctx.textAlign = 'center';
      ctx.font = 'bold 23px Georgia';
      ctx.fillText(labels[i][0], x + 170, 867);
      ctx.font = '18px Georgia';
      ctx.fillText(labels[i][1], x + 170, 916);
      ctx.strokeStyle = '#604d2c';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 10, 818, 320, 144);
    }
  });
}

function neonAtlas() {
  return canvasTexture(1536, 512, (ctx) => {
    ctx.clearRect(0, 0, 1536, 512);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const signs = [
      { x: 0, w: 1024, label: 'WINNERS CLUB', font: 105, color: '#f6b65c' },
      { x: 1024, w: 512, label: 'POOL', font: 125, color: '#76d9d1' },
    ];
    for (const sign of signs) {
      ctx.font = `${sign.font}px Georgia`;
      ctx.lineJoin = 'round';
      // The halo lives in this small static texture, so it survives the fast
      // renderer's no-bloom path and introduces no extra scene light.
      for (const blur of [42, 22, 9]) {
        ctx.shadowColor = sign.color;
        ctx.shadowBlur = blur;
        ctx.strokeStyle = sign.color;
        ctx.lineWidth = 3;
        ctx.strokeText(sign.label, sign.x + sign.w / 2, 256);
      }
      ctx.shadowBlur = 0;
      ctx.strokeStyle = sign.color;
      ctx.lineWidth = 3.8;
      ctx.strokeText(sign.label, sign.x + sign.w / 2, 256);
      ctx.strokeStyle = '#fff5dd';
      ctx.lineWidth = 1.2;
      ctx.strokeText(sign.label, sign.x + sign.w / 2, 256);
    }
  });
}

/** Blender-authored wall models. Runtime code only binds textures/materials and
 * retains wall ownership; it never constructs the awards, boards or glass. */
export function buildPubClubDecor(
  walls: { left: THREE.Group; right: THREE.Group; front: THREE.Group },
  installer: PropInstaller,
) {
  const sections = { left: new THREE.Group(), right: new THREE.Group(), front: new THREE.Group() };
  for (const [wall, section] of Object.entries(sections)) {
    section.name = `pub-club-decor-${wall}`;
    walls[wall as keyof typeof sections].add(section);
  }
  // Bound canvas maps get the installer's prop anisotropy with the rest of each model.
  const printMap = clubPrints(),
    glowMap = neonAtlas(),
    woodMap = woodTexture();
  for (const map of [printMap, glowMap, woodMap]) map.flipY = false;
  const bindMaps = (source: THREE.Object3D) => {
    const retiredMaterials = new Set<THREE.Material>(),
      retiredTextures = new Set<THREE.Texture>();
    source.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      const bind = (material: THREE.Material) => {
        const name = material.name.replace(/\.\d+$/, '');
        if (name === 'Baked club neon glow' || name === 'Club amber neon glass' || name === 'Club cyan neon glass') {
          retiredMaterials.add(material);
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) retiredTextures.add(value);
          object.castShadow = false;
          object.receiveShadow = false;
          if (name === 'Baked club neon glow')
            return new THREE.MeshBasicMaterial({
              name,
              map: glowMap,
              transparent: true,
              depthWrite: false,
              toneMapped: false,
            });
          return new THREE.MeshBasicMaterial({
            name,
            color: name.includes('amber') ? '#ffe2a1' : '#b8fff0',
            toneMapped: false,
          });
        }
        if (material instanceof THREE.MeshStandardMaterial) {
          const map = name === 'Club archival print' ? printMap : name === 'Club display walnut' ? woodMap : null;
          if (map) {
            if (material.map) retiredTextures.add(material.map);
            material.map = map;
            material.color.set(name === 'Club archival print' ? '#ffffff' : '#75563c');
            material.needsUpdate = true;
          }
          material.envMapIntensity = name.includes('silver') ? 0.75 : 0.8;
          if (name === 'Club archival print') {
            material.roughness = 0.9;
            object.castShadow = false;
          }
        }
        return material;
      };
      object.material = Array.isArray(object.material) ? object.material.map(bind) : bind(object.material);
    });
    for (const material of retiredMaterials) material.dispose();
    for (const texture of retiredTextures) texture.dispose();
  };
  for (const wall of Object.keys(sections) as (keyof typeof sections)[])
    installer.model(PUB_CLUB_DECOR_PROPS[wall], { parent: sections[wall], prepare: bindMaps });
  return {
    diagnostics() {
      let triangles = 0;
      for (const section of Object.values(sections))
        section.traverse((object) => {
          if (object instanceof THREE.Mesh)
            triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
        });
      return {
        loadedModels: Object.values(sections).filter((section) => section.children.length).length,
        drawCalls: Object.values(sections).reduce((sum, section) => sum + countPubDraws(section), 0),
        triangles,
      };
    },
    /** Maps the walls draw are released with the room; only the unbound ones are freed here. */
    dispose() {
      const drawn = new Set<object>();
      for (const section of Object.values(sections)) for (const resource of pubResources(section)) drawn.add(resource);
      for (const map of [printMap, glowMap, woodMap]) if (!drawn.has(map)) map.dispose();
    },
  };
}
