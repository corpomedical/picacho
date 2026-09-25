-- Recast takes any video, not only MP4 and MOV (2026-09-25).
--
-- Operator: "Tried uploading a video to recast and it failed because of file
-- formats. Can we expand format compatibility?" The door took MP4 and MOV
-- and nothing else, and so did this bucket (applied/2026-09-18/recast.sql).
-- Now a WebM, an MKV, an AVI, a WMV, an FLV, a 3GP, an MPEG, an MPEG-TS
-- (.ts/.mts/.m2ts) or an Ogg video uploads as it is, and the server converts
-- it to an H.264 MP4 before anything is read or sent
-- (src/lib/recast/convert-run.ts). A take still stands on an MP4 or a MOV.
--
-- RUN THIS BEFORE PUSHING THE CODE. Idempotent: a second paste is harmless.
-- Safe in either order: until it has run, the door refuses the new formats
-- with a sentence naming this file (reserveRecastUpload reads the bucket's
-- list), before a byte is uploaded; MP4 and MOV work exactly as before.
--
-- The list is exactly recast.ts RECAST_UPLOAD_TYPES — the one type each
-- format is uploaded under, whatever the browser called the file — so a
-- bypassed client still cannot store anything else. The 50 MB limit stays.

update storage.buckets
   set allowed_mime_types = array[
     'video/mp4',
     'video/quicktime',
     'video/webm',
     'video/x-matroska',
     'video/x-msvideo',
     'video/x-ms-wmv',
     'video/x-flv',
     'video/3gpp',
     'video/mpeg',
     'video/mp2t',
     'video/ogg'
   ]
 where id = 'recast-sources';

-- Check: one row, eleven types.
select id, file_size_limit, allowed_mime_types
  from storage.buckets
 where id = 'recast-sources';
