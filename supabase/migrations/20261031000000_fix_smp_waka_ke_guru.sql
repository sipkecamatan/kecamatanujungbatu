-- Perbaiki role Fitri Handayani dan Rosmaini dari waka SMA/SMK ke GURU
-- Keduanya guru SMP biasa; Syahrul Ramadhan (WAKA_KESISWAAN) tetap sebagai Wakasek SMP.

ALTER TABLE users DISABLE TRIGGER trg_guard_users_protected_columns;

UPDATE users
SET role_type = 'GURU'
WHERE login_identifier IN ('198910082015032911', '197904182005032910')
  AND role_type IN ('WAKA_HUMAS', 'WAKA_KURIKULUM');

ALTER TABLE users ENABLE TRIGGER trg_guard_users_protected_columns;
