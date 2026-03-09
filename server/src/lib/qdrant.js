import { QdrantClient } from '@qdrant/js-client-rest';

const COLLECTION = 'face_embeddings';
const VECTOR_SIZE = 512; // Azure Face API embedding dimensions

export const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL || 'http://localhost:6333',
  apiKey: process.env.QDRANT_API_KEY || undefined,
});

// Ensure the collection exists on startup. Safe to call multiple times.
export async function ensureCollection() {
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some((c) => c.name === COLLECTION);
  if (!exists) {
    await qdrant.createCollection(COLLECTION, {
      vectors: {
        size: VECTOR_SIZE,
        distance: 'Cosine',
      },
    });
    console.log(`[Qdrant] Created collection "${COLLECTION}"`);
  }
}

// Upsert a face embedding vector.
// pointId should be the qdrant_point_id from the face_embeddings table (UUID string).
export async function upsertEmbedding(pointId, vector, payload) {
  await qdrant.upsert(COLLECTION, {
    points: [
      {
        id: pointId,
        vector,
        payload, // { userId, sourceType }
      },
    ],
  });
}

// Find the highest cosine similarity score between a query vector
// and all stored embeddings for a given userId.
// Returns { score, pointId } of the best match, or null if no embeddings found.
export async function searchUserEmbeddings(userId, queryVector) {
  const results = await qdrant.search(COLLECTION, {
    vector: queryVector,
    limit: 10,
    filter: {
      must: [{ key: 'userId', match: { value: userId } }],
    },
    with_payload: false,
  });

  if (!results.length) return null;

  // Results are sorted by score descending
  return { score: results[0].score, pointId: String(results[0].id) };
}

// Delete all embeddings for a user (called on account deletion).
export async function deleteUserEmbeddings(userId) {
  await qdrant.delete(COLLECTION, {
    filter: {
      must: [{ key: 'userId', match: { value: userId } }],
    },
  });
}
