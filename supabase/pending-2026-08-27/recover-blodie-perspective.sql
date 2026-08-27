-- Recover Blodie's lost Perspective shots (2026-08-27, operator: "I tried
-- the perspective option, but forgot to hit save. All the images generated
-- are lost").
--
-- What happened: Perspective generated and UPLOADED three reference photos
-- (front, three-quarter, profile — storage timestamps 01:38–01:39 today,
-- visually verified as Blodie), but the character row only learns about
-- photos on "Save character", so they sat orphaned in the bucket. This
-- appends them in shot order after her two existing photos: 2 + 3 = 5,
-- exactly the photo cap Perspective fills to.
--
-- Idempotent: the WHERE clause refuses to run twice or over a changed row.
UPDATE public.character_profiles
SET reference_image_urls = ARRAY[
      'a3102bc1-2355-444a-8ade-caafd7980218/7f3ac7c9-9f07-49db-bb50-61331fdba224-generated.png',
      'a3102bc1-2355-444a-8ade-caafd7980218/8704bcb9-056d-4fd7-a892-316300903363-generated.png',
      'a3102bc1-2355-444a-8ade-caafd7980218/2073d268-0554-4ea2-8f4b-dc699cb1f1cf.png',
      'a3102bc1-2355-444a-8ade-caafd7980218/ac140dd2-36dd-4afb-b976-6ca1185f08f2.png',
      'a3102bc1-2355-444a-8ade-caafd7980218/bdb5e18e-c57c-4cb5-8f90-8f8021b6304b.png'
    ],
    updated_at = now()
WHERE id = '750e1e3f-a4fd-4820-88ce-70956f3250e9'
  AND user_id = 'a3102bc1-2355-444a-8ade-caafd7980218'
  AND array_length(reference_image_urls, 1) = 2;
