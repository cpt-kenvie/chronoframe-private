import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import Database from 'better-sqlite3'

const imageLoader = await readFile(
  'app/libs/image-loader-manager.ts',
  'utf8',
)
const reactionApi = await readFile(
  'server/api/photos/[photoId]/reactions.ts',
  'utf8',
)
const albumPhotosApi = await readFile(
  'server/api/albums/[albumId]/photos/index.post.ts',
  'utf8',
)
const livePhotoApi = await readFile(
  'server/api/photos/[photoId]/livephoto.get.ts',
  'utf8',
)
const photoUpdateApi = await readFile(
  'server/api/photos/[photoId]/index.put.ts',
  'utf8',
)
const exifReindexApi = await readFile(
  'server/api/photos/exif/reindex.post.ts',
  'utf8',
)
const livePhotoManageApi = await readFile(
  'server/api/photos/livephoto/manage.post.ts',
  'utf8',
)
const taskStatsApi = await readFile(
  'server/api/queue/stats/[taskId].get.ts',
  'utf8',
)
const queueStatsApi = await readFile('server/api/queue/stats/index.ts', 'utf8')
const schema = await readFile('server/database/schema.ts', 'utf8')
const reactionMigration = await readFile(
  'server/database/migrations/0013_blushing_timeslip.sql',
  'utf8',
)

test('normal image loading reuses the downloaded Blob URL immediately', () => {
  assert.match(imageLoader, /normalImageCache\.set\(cacheKey, result\)[\s\S]*blobSrc: url/)
  assert.doesNotMatch(imageLoader, /blobSrc: originalUrl/)
})

test('photo reactions use a composite unique index and conflict update', () => {
  assert.match(
    schema,
    /uniqueIndex\('photo_reactions_photo_fingerprint_idx'\)[\s\S]*table\.photoId,[\s\S]*table\.fingerprint/,
  )
  assert.match(reactionApi, /\.onConflictDoUpdate\(\{[\s\S]*target: \[[\s\S]*photoId,[\s\S]*fingerprint/)
})

test('reaction migration removes duplicates before enforcing uniqueness', () => {
  const database = new Database(':memory:')

  try {
    database.exec(`
      CREATE TABLE photo_reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        photo_id TEXT NOT NULL,
        reaction_type TEXT NOT NULL,
        fingerprint TEXT NOT NULL
      );
      CREATE INDEX photo_reactions_photo_fingerprint_idx
        ON photo_reactions (photo_id, fingerprint);
      INSERT INTO photo_reactions (photo_id, reaction_type, fingerprint) VALUES
        ('photo-1', 'like', 'visitor-1'),
        ('photo-1', 'wow', 'visitor-1'),
        ('photo-2', 'love', 'visitor-1');
    `)

    for (const statement of reactionMigration.split('--> statement-breakpoint')) {
      if (statement.trim()) database.exec(statement)
    }

    const reactions = database
      .prepare(
        'SELECT photo_id, reaction_type, fingerprint FROM photo_reactions ORDER BY photo_id',
      )
      .all()

    assert.deepEqual(reactions, [
      {
        photo_id: 'photo-1',
        reaction_type: 'wow',
        fingerprint: 'visitor-1',
      },
      {
        photo_id: 'photo-2',
        reaction_type: 'love',
        fingerprint: 'visitor-1',
      },
    ])
    assert.throws(() => {
      database
        .prepare(
          'INSERT INTO photo_reactions (photo_id, reaction_type, fingerprint) VALUES (?, ?, ?)',
        )
        .run('photo-1', 'fire', 'visitor-1')
    }, /UNIQUE constraint failed/)
  } finally {
    database.close()
  }
})

test('album photo insertion deduplicates input and reports database changes', () => {
  assert.match(albumPhotosApi, /const photoIds = \[\.\.\.new Set\(body\.photoIds\)\]/)
  assert.match(albumPhotosApi, /photos\.length !== photoIds\.length/)
  assert.match(albumPhotosApi, /addedCount \+= insertResult\.changes/)
  assert.match(albumPhotosApi, /return \{ success: true, addedCount \}/)
})

test('photo and queue status APIs preserve existing H3 errors', () => {
  for (const api of [
    livePhotoApi,
    photoUpdateApi,
    exifReindexApi,
    livePhotoManageApi,
    taskStatsApi,
    queueStatsApi,
  ]) {
    assert.match(api, /if \(isError\(error\)\) \{\s*throw error\s*\}/)
  }
})
