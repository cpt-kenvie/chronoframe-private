DROP INDEX `photo_reactions_photo_fingerprint_idx`;--> statement-breakpoint
-- 保留每个照片与指纹组合中最后创建的表态，避免历史重复数据阻断唯一索引创建。
DELETE FROM `photo_reactions`
WHERE `id` NOT IN (
	SELECT MAX(`id`)
	FROM `photo_reactions`
	GROUP BY `photo_id`, `fingerprint`
);--> statement-breakpoint
CREATE UNIQUE INDEX `photo_reactions_photo_fingerprint_idx` ON `photo_reactions` (`photo_id`,`fingerprint`);
