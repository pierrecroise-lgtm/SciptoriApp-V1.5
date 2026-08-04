// ScriptoriApp — traitement local des illustrations de grimoires.
// Aucun envoi d'image vers un serveur : l'image est transformée dans le navigateur.

const MAX_WIDTH = 256;
const MAX_HEIGHT = 360;
const PIXEL_WIDTH = 64;
const PIXEL_HEIGHT = 90;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Impossible de lire cette image.'));
    };
    img.src = url;
  });
}

function fitContain(width, height, maxWidth, maxHeight) {
  const ratio = Math.min(maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function quantizePixelArt(ctx, width, height) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Palette volontairement assez large pour conserver les visages, textes et détails,
  // tout en donnant un rendu de sprites/illustrations D&D rétro.
  const levels = [0, 48, 96, 144, 192, 240];
  const nearest = (value) => levels[Math.min(levels.length - 1, Math.round(value / 48))];

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    data[i] = nearest(data[i]);
    data[i + 1] = nearest(data[i + 1]);
    data[i + 2] = nearest(data[i + 2]);
  }

  ctx.putImageData(imageData, 0, 0);
}

export async function processBookIllustration(file) {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('Sélectionne une image valide.');
  }

  const img = await loadImage(file);
  const fitted = fitContain(img.naturalWidth, img.naturalHeight, PIXEL_WIDTH, PIXEL_HEIGHT);

  // Première passe très basse résolution = vrais gros pixels.
  const low = document.createElement('canvas');
  low.width = fitted.width;
  low.height = fitted.height;
  const lowCtx = low.getContext('2d', { alpha: false });
  lowCtx.imageSmoothingEnabled = true;
  lowCtx.fillStyle = '#1c1209';
  lowCtx.fillRect(0, 0, low.width, low.height);

  const sourceRatio = img.naturalWidth / img.naturalHeight;
  const targetRatio = low.width / low.height;
  let drawWidth = low.width;
  let drawHeight = low.height;
  let drawX = 0;
  let drawY = 0;

  if (sourceRatio > targetRatio) {
    drawHeight = Math.round(low.width / sourceRatio);
    drawY = Math.round((low.height - drawHeight) / 2);
  } else {
    drawWidth = Math.round(low.height * sourceRatio);
    drawX = Math.round((low.width - drawWidth) / 2);
  }

  lowCtx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
  quantizePixelArt(lowCtx, low.width, low.height);

  // Seconde passe : agrandissement sans interpolation pour préserver les pixels.
  const output = document.createElement('canvas');
  const scale = Math.min(MAX_WIDTH / low.width, MAX_HEIGHT / low.height);
  output.width = Math.max(low.width, Math.round(low.width * scale));
  output.height = Math.max(low.height, Math.round(low.height * scale));

  const outCtx = output.getContext('2d', { alpha: false });
  outCtx.imageSmoothingEnabled = false;
  outCtx.fillStyle = '#1c1209';
  outCtx.fillRect(0, 0, output.width, output.height);
  outCtx.drawImage(low, 0, 0, output.width, output.height);

  // WebP réduit fortement le poids sur les navigateurs modernes ; JPEG sert de repli.
  const webp = output.toDataURL('image/webp', 0.76);
  return webp.startsWith('data:image/webp')
    ? webp
    : output.toDataURL('image/jpeg', 0.76);
}
