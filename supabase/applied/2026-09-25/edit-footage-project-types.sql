-- Director's Cut keeps each video's editable project in the footage bucket (2026-09-25).
--
-- Operator: "Put the video we made on the new timeline." The project of his
-- first edit was rebuilt and its upload stopped at the second file:
-- "upload assets/gsap.min.js: mime type text/javascript is not supported".
-- The bucket (applied/2026-09-25/video-editor.sql) takes only footage types:
-- video, audio and JPEG. But a project is a web page: index.html, its
-- scripts, style sheets, fonts and images, next to its audio. So as it
-- stands, no delivered project can be kept (the page is text/html), the
-- timeline never opens for a new edit, and the bay's autosave (draft.html)
-- is refused.
--
-- RUN THIS, then re-run the attach command for his edit. Idempotent: a second
-- paste is harmless. No code waits on it; the code already asks for these types.
--
-- The list is the footage types it had, plus exactly the types the editor
-- stores a project's files under (src/lib/editor/advance.ts PROJECT_TYPES,
-- actions.ts saveProjectDraft + composeTrack). The bucket stays private, and
-- its 1 GB limit stays. People still only upload through signed tokens the
-- server mints for their own clip paths; the project files are written by
-- the server alone. The preview route serves every .html page itself, under
-- its own policy, and never hands out a link to one.

update storage.buckets
   set allowed_mime_types = array[
     -- footage, as before
     'video/mp4',
     'video/quicktime',
     'video/webm',
     'audio/mpeg',
     'audio/mp4',
     'audio/x-m4a',
     'audio/wav',
     'audio/x-wav',
     'image/jpeg',
     -- a project's page and what it loads
     'text/html',
     'text/css',
     'text/javascript',
     'application/json',
     'audio/ogg',
     'image/png',
     'image/webp',
     'image/gif',
     'image/svg+xml',
     'font/woff2',
     'font/woff',
     'font/ttf',
     'font/otf'
   ]
 where id = 'edit-footage';

-- VERIFY (should show the 22 types above, private, 1 GB):
select id, public, file_size_limit, array_length(allowed_mime_types, 1) as types, allowed_mime_types
  from storage.buckets
 where id = 'edit-footage';
