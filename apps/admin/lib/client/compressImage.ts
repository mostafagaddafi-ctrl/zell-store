'use client'

const WEBP_QUALITY = 0.85
const WEBP_TYPE = 'image/webp'
const SUPPORTED_INPUTS = new Set(['image/jpeg', 'image/png', 'image/avif'])

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('IMAGE_DECODE_FAILED'))
    }
    image.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('WEBP_ENCODE_FAILED'))), WEBP_TYPE, WEBP_QUALITY)
  })
}

/** ضغط اختياري: WebP لا يُضغط ثانية، وأي فشل يرجّع الأصل. */
export async function compressUploadImage(file: File): Promise<File> {
  if (file.type === WEBP_TYPE || !SUPPORTED_INPUTS.has(file.type)) return file

  try {
    const image = await loadImage(file)
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) return file
    context.drawImage(image, 0, 0)

    const blob = await canvasToBlob(canvas)
    if (blob.size >= file.size) return file
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'image'
    return new File([blob], baseName + '.webp', { type: WEBP_TYPE, lastModified: file.lastModified })
  } catch {
    return file
  }
}
