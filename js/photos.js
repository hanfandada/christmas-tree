import * as THREE from 'three';

/**
 * 照片的本地存储与纹理化。
 *
 * 全部在浏览器里完成，照片不会离开这台设备：
 *  - 选中的图片先裁成正方形、压到 512px，再存进 IndexedDB
 *  - 读取时把 Blob 转成 three 纹理
 *  - 若浏览器禁用 IndexedDB，则退化为内存存储（刷新即失）
 */

const DB_NAME = 'xmas-tree';
const DB_VERSION = 1;
const STORE = 'photos';
const MAX_EDGE = 512;

let dbPromise = null;
let memoryOnly = false;
const memoryRows = [];

function openDB() {
  if (dbPromise) return dbPromise;
  if (!('indexedDB' in window)) {
    memoryOnly = true;
    return Promise.resolve(null);
  }

  dbPromise = new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      memoryOnly = true;
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      memoryOnly = true;
      resolve(null);
    };
  });

  return dbPromise;
}

function transaction(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

/** 读取全部照片，按创建时间升序 */
export async function listPhotos() {
  const db = await openDB();
  if (!db) return [...memoryRows].sort((a, b) => a.createdAt - b.createdAt);

  return new Promise((resolve) => {
    const request = transaction(db, 'readonly').getAll();
    request.onsuccess = () => {
      const rows = (request.result || []).sort((a, b) => a.createdAt - b.createdAt);
      resolve(rows);
    };
    request.onerror = () => resolve([]);
  });
}

/** 新增一张照片，返回记录 */
export async function savePhoto(blob) {
  const row = {
    id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now() + Math.random()),
    createdAt: Date.now(),
    blob,
  };

  const db = await openDB();
  if (!db) {
    memoryRows.push(row);
    return row;
  }

  return new Promise((resolve) => {
    const request = transaction(db, 'readwrite').put(row);
    request.onsuccess = () => resolve(row);
    request.onerror = () => {
      memoryRows.push(row);
      resolve(row);
    };
  });
}

/** 删除一张照片 */
export async function removePhoto(id) {
  const db = await openDB();
  if (!db) {
    const index = memoryRows.findIndex((row) => row.id === id);
    if (index >= 0) memoryRows.splice(index, 1);
    return;
  }

  await new Promise((resolve) => {
    const request = transaction(db, 'readwrite').delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
}

export function isMemoryOnly() {
  return memoryOnly;
}

/** 把用户选的文件裁成正方形并压缩，返回 JPEG Blob */
export async function fileToSquareBlob(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = MAX_EDGE;
  canvas.height = MAX_EDGE;
  const ctx = canvas.getContext('2d');

  // cover：短边填满，多出来的居中裁掉
  const scale = Math.max(MAX_EDGE / bitmap.width, MAX_EDGE / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, (MAX_EDGE - width) / 2, (MAX_EDGE - height) / 2, width, height);

  if (bitmap.close) bitmap.close();

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.86);
  });
}

/**
 * 只取照片的平均色（1x1 采样），给树上的礼物盒上色。
 * 不保留完整纹理，几十张照片也不会占显存。
 */
export async function blobToAverageColor(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, 1, 1);
  if (bitmap.close) bitmap.close();

  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  const color = new THREE.Color().setRGB(r / 255, g / 255, b / 255);
  // 往暖金色偏一点，和节日的灯串更协调
  color.lerp(new THREE.Color(0xffcf9a), 0.25);
  return color;
}
