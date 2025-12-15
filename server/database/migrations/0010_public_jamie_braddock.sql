ALTER TABLE `albums` ADD `is_hidden` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `photos` ADD `is_video` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `photos` ADD `duration` real;--> statement-breakpoint
ALTER TABLE `photos` ADD `video_codec` text;--> statement-breakpoint
ALTER TABLE `photos` ADD `audio_codec` text;--> statement-breakpoint
ALTER TABLE `photos` ADD `bitrate` integer;--> statement-breakpoint
ALTER TABLE `photos` ADD `frame_rate` real;--> statement-breakpoint
CREATE UNIQUE INDEX `album_photos_album_id_photo_id_unique` ON `album_photos` (`album_id`,`photo_id`);