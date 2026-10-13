-- Baseline skema SIP — dihasilkan dari katalog database (hanya SELECT), 13 Okt 2026.
-- Mencakup schema public dan core. TIDAK mencakup data (seed), pengguna, atau rahasia.
-- Catatan: pg_cron/pg_net perlu diaktifkan di proyek baru; URL cron harus diganti (lihat bagian akhir).
SET check_function_bodies = false;
-- db push memakai search_path default tanpa schema extensions; default seperti uuid_generate_v4() butuh ini.
SET search_path = public, extensions;
SET statement_timeout = 0;

-- ============================================================
-- Ekstensi
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "btree_gist" WITH SCHEMA extensions;
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA extensions; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_net tidak dapat dibuat: %. Aktifkan lewat dashboard.', SQLERRM; END $$; -- pg_net
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS "pg_cron"; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_cron tidak dapat dibuat: %. Aktifkan lewat dashboard.', SQLERRM; END $$; -- pg_cron
CREATE SCHEMA IF NOT EXISTS core;

-- ============================================================
-- Enum
-- ============================================================
DO $$ BEGIN CREATE TYPE public.achievement_category AS ENUM ('AKADEMIK', 'NON_AKADEMIK', 'SERTIFIKASI', 'PENGHARGAAN'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.achievement_scope AS ENUM ('SEKOLAH', 'KABUPATEN', 'PROVINSI', 'NASIONAL', 'INTERNASIONAL'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.attendance_source AS ENUM ('AUTO_DETECTED', 'MANUAL_OVERRIDE', 'TEACHER_DECLARED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.attendance_status AS ENUM ('HADIR', 'ALPA', 'IZIN', 'SAKIT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.case_status AS ENUM ('OPEN', 'UNDER_REVIEW', 'INTERVENTION', 'MONITORING', 'CLOSED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.case_track AS ENUM ('SEKOLAH', 'PKL'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.coaching_case_event_type AS ENUM ('OPENED', 'NOTE_ADDED', 'CASE_EDITED', 'ESCALATED', 'STATUS_CHANGED', 'SHARED_TO_STUDENT', 'UNSHARED_FROM_STUDENT', 'SHARED_TO_PARENT', 'UNSHARED_FROM_PARENT', 'CLOSED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.day_of_week AS ENUM ('SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.ld_document_status AS ENUM ('draft', 'published'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.ld_document_type AS ENUM ('atp', 'modul_ajar', 'rpp_ringkas', 'lkpd', 'soal', 'rubrik', 'observasi', 'remedial'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.ld_generation_source AS ENUM ('AI', 'MANUAL', 'HYBRID'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.ld_node_type AS ENUM ('tp_item', 'identitas', 'kompetensi_awal', 'profil_lulusan_dimensi', 'mindful', 'meaningful', 'joyful', 'asesmen_diagnostik', 'asesmen_formatif', 'asesmen_sumatif', 'refleksi', 'lampiran', 'petunjuk', 'aktivitas', 'pertanyaan', 'soal_pg', 'soal_uraian', 'soal_hots', 'kriteria_pengetahuan', 'kriteria_keterampilan', 'kriteria_sikap', 'indikator_checklist', 'aktivitas_remedial', 'aktivitas_pengayaan'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.meeting_status AS ENUM ('NORMAL', 'KEGIATAN_SEKOLAH', 'GURU_TIDAK_HADIR'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.message_direction AS ENUM ('INBOUND', 'OUTBOUND'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.message_link_type AS ENUM ('CASE_LINKED', 'STANDALONE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.observation_dimension AS ENUM ('AKADEMIK', 'KEHADIRAN', 'PERILAKU', 'SOSIAL', 'AFEKTIF', 'BAKAT_MINAT', 'FISIK', 'LAINNYA'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.observation_sentiment AS ENUM ('POSITIF', 'NEGATIF'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.role_type AS ENUM ('GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK', 'DUDI', 'SISWA', 'ORTU', 'ADMINISTRATIVE', 'STAKEHOLDER', 'WAKA_KURIKULUM', 'WAKA_KESISWAAN', 'WAKA_HUMAS', 'TU'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.semester AS ENUM ('1', '2'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.student_status AS ENUM ('AKTIF', 'PKL', 'LULUS', 'KELUAR'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.teacher_attendance_indicator AS ENUM ('HADIR', 'TIDAK_HADIR', 'PENDING_EVALUATION'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.visibility_level AS ENUM ('PRIVATE', 'INTERNAL_SCHOOL', 'STUDENT_VISIBLE', 'RESTRICTED', 'PUBLIC', 'SISWA_SAJA', 'ORTU_SAJA', 'SISWA_DAN_ORTU'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Sequence
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS public.audit_log_id_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1;
CREATE SEQUENCE IF NOT EXISTS public.schedule_reapply_targets_target_id_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1;

-- ============================================================
-- Tabel (default yang memanggil fungsi aplikasi ditunda ke setelah fungsi dibuat)
-- ============================================================
CREATE TABLE IF NOT EXISTS core.capaian_pembelajaran (
  "cp_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "subject_phase_id" uuid NOT NULL,
  "version_id" uuid NOT NULL,
  "cp_code" character varying(50),
  "rasional" text,
  "tujuan" text,
  "karakteristik" text,
  "cp_umum" text,
  "display_order" integer DEFAULT 1 NOT NULL,
  "bskap_ref" character varying(100),
  "effective_date" date,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS core.cp_elements (
  "element_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "cp_id" uuid NOT NULL,
  "element_order" integer NOT NULL,
  "nama_elemen" character varying(200) NOT NULL,
  "deskripsi_cp" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL
);
CREATE TABLE IF NOT EXISTS core.curriculum_versions (
  "version_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "version_code" character varying(20) NOT NULL,
  "name" text NOT NULL,
  "regulation_ref" text NOT NULL,
  "effective_from" date NOT NULL,
  "effective_until" date,
  "is_active" boolean DEFAULT true NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS core.education_levels (
  "level_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "code" character varying(10) NOT NULL,
  "name" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL
);
CREATE TABLE IF NOT EXISTS core.knowledge_national (
  "kn_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "program_id" uuid,
  "category" character varying(50) NOT NULL,
  "label" character varying(200) NOT NULL,
  "deskripsi" text NOT NULL,
  "tags" text[],
  "version_id" uuid NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS core.phases (
  "phase_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "level_id" uuid NOT NULL,
  "code" character varying(5) NOT NULL,
  "name" text NOT NULL,
  "grade_range" character varying(20)
);
CREATE TABLE IF NOT EXISTS core.subject_name_mapping (
  "mapping_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "kode_pattern" character varying(50) NOT NULL,
  "program_hint" character varying(20),
  "grade_level" smallint,
  "core_subject_id" uuid NOT NULL,
  "confidence" character varying(10) DEFAULT 'HIGH'::character varying NOT NULL,
  "notes" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS core.subject_phases (
  "subject_phase_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "subject_id" uuid NOT NULL,
  "phase_id" uuid NOT NULL,
  "version_id" uuid NOT NULL,
  "jp_per_week" integer
);
CREATE TABLE IF NOT EXISTS core.subjects (
  "subject_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "code" character varying(30) NOT NULL,
  "name" text NOT NULL,
  "subject_type" character varying(30) NOT NULL,
  "program_id" uuid,
  "concentration_id" uuid,
  "is_generatable" boolean DEFAULT true NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL
);
CREATE TABLE IF NOT EXISTS core.vocational_concentrations (
  "concentration_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "program_id" uuid NOT NULL,
  "code" character varying(20) NOT NULL,
  "name" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL
);
CREATE TABLE IF NOT EXISTS core.vocational_fields (
  "field_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "code" character varying(10) NOT NULL,
  "name" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL
);
CREATE TABLE IF NOT EXISTS core.vocational_programs (
  "program_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "field_id" uuid NOT NULL,
  "code" character varying(20) NOT NULL,
  "name" text NOT NULL,
  "name_short" character varying(50),
  "is_active" boolean DEFAULT true NOT NULL
);
CREATE TABLE IF NOT EXISTS public.academic_periods (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "academic_year" character varying(9) NOT NULL,
  "semester" semester NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "status" character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
  "closed_at" timestamp with time zone,
  "closed_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "school_id" uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.assessment_criteria (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "learning_objective_id" uuid NOT NULL,
  "school_id" uuid NOT NULL,
  "predikat" text,
  "batas_bawah" numeric(5,2),
  "batas_atas" numeric(5,2),
  "keterangan" text,
  "urutan" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "rentang" jsonb
);
CREATE TABLE IF NOT EXISTS public.assessment_results (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "class_id" uuid NOT NULL,
  "assessment_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "nilai" numeric(5,2),
  "status" text,
  "tindak_lanjut" text,
  "umpan_balik" text,
  "catatan" text,
  "grup_diferensiasi" text,
  "kktp_tercapai" boolean,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.assessment_rubric_criteria (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "assessment_id" uuid NOT NULL,
  "school_id" uuid NOT NULL,
  "teacher_id" uuid NOT NULL,
  "nama" text NOT NULL,
  "bobot" numeric(5,2) NOT NULL,
  "deskripsi_level" jsonb,
  "urutan" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.assessment_rubric_results (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "criteria_id" uuid NOT NULL,
  "assessment_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "school_id" uuid NOT NULL,
  "teacher_id" uuid NOT NULL,
  "level_dipilih" integer,
  "skor_hasil" numeric(5,2),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.assessments (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "teacher_id" uuid NOT NULL,
  "class_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "academic_year" character varying(9) NOT NULL,
  "semester" integer NOT NULL,
  "jenis" text NOT NULL,
  "teknik" text,
  "tanggal" date,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "instrumen" text,
  "tujuan" text,
  "konten" jsonb,
  "refleksi_guru" text,
  "is_visible_siswa" boolean DEFAULT false NOT NULL,
  "is_visible_ortu" boolean DEFAULT false NOT NULL,
  "learning_objective_id" uuid
);
CREATE TABLE IF NOT EXISTS public.attendance (
  "attendance_id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "schedule_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "status" attendance_status DEFAULT 'HADIR'::attendance_status NOT NULL,
  "source" attendance_source DEFAULT 'AUTO_DETECTED'::attendance_source NOT NULL,
  "is_void" boolean DEFAULT false NOT NULL,
  "void_reason" text,
  "recorded_by_user_id" uuid NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "school_id" uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.audit_log (
  "id" bigint GENERATED ALWAYS AS IDENTITY,
  "school_id" uuid NOT NULL,
  "table_name" text NOT NULL,
  "operation" text DEFAULT 'DELETE'::text NOT NULL,
  "row_id" text NOT NULL,
  "row_snapshot" jsonb NOT NULL,
  "deleted_by" uuid,
  "deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.bk_class_assignments (
  "assignment_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "bk_user_id" uuid NOT NULL,
  "class_id" uuid NOT NULL,
  "academic_year" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
  "assigned_by_user_id" uuid
);
CREATE TABLE IF NOT EXISTS public.capaian_pembelajaran (
  "cp_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "program_id" uuid,
  "fase" character varying(1) NOT NULL,
  "elemen" character varying(100) NOT NULL,
  "deskripsi_cp" text NOT NULL,
  "generated_by" character varying(10) DEFAULT 'MANUAL'::character varying NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.class_enrollments (
  "enrollment_id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "student_id" uuid NOT NULL,
  "class_id" uuid NOT NULL,
  "academic_year" character varying(9) NOT NULL,
  "semester" semester NOT NULL,
  "enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
  "withdrawn_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "school_id" uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.classes (
  "class_id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "name" character varying(50) NOT NULL,
  "program_id" uuid NOT NULL,
  "academic_year" character varying(9) NOT NULL,
  "grade_level" smallint NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "school_id" uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.coaching_case_events (
  "event_id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "case_id" uuid NOT NULL,
  "school_id" uuid NOT NULL,
  "event_type" coaching_case_event_type NOT NULL,
  "author_user_id" uuid NOT NULL,
  "is_visible_to_student" boolean DEFAULT false NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.coaching_case_handlers (
  "handler_id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "case_id" uuid NOT NULL,
  "school_id" uuid NOT NULL,
  "handler_user_id" uuid NOT NULL,
  "assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
  "assigned_by_user_id" uuid,
  "handover_at" timestamp with time zone
);
CREATE TABLE IF NOT EXISTS public.coaching_case_templates (
  "template_id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "school_id" uuid NOT NULL,
  "name" character varying(200) NOT NULL,
  "description" text,
  "storage_path" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.coaching_cases (
  "case_id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "created_by_user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "title" character varying(200) NOT NULL,
  "description" text NOT NULL,
  "current_handler_user_id" uuid NOT NULL,
  "status" case_status DEFAULT 'OPEN'::case_status NOT NULL,
  "track" case_track DEFAULT 'SEKOLAH'::case_track NOT NULL,
  "is_shared_to_student" boolean DEFAULT false NOT NULL,
  "is_shared_to_parent" boolean DEFAULT false NOT NULL,
  "closed_at" timestamp with time zone,
  "closed_by_user_id" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.communication_categories (
  "category_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "category_code" text NOT NULL,
  "label_sekolah" text NOT NULL,
  "polarity" text DEFAULT 'NEUTRAL'::text NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL
);
CREATE TABLE IF NOT EXISTS public.duty_schedules (
  "duty_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "day_of_week" day_of_week NOT NULL,
  "academic_year" text NOT NULL,
  "semester" integer NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
  "assigned_by_user_id" uuid
);
CREATE TABLE IF NOT EXISTS public.evaluation_logs (
  "log_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL,
  "school_id" uuid NOT NULL,
  "teacher_user_id" uuid NOT NULL,
  "doc_id" uuid,
  "document_type" character varying(30),
  "core_subject_id" uuid,
  "phase_id" uuid,
  "program_id" uuid,
  "curriculum_version" character varying(20),
  "knowledge_version" character varying(20),
  "template_version" character varying(20),
  "formatter_version" character varying(20),
  "system_instruction_v" character varying(20),
  "model_version" character varying(50),
  "provider" character varying(20),
  "input_tokens" integer,
  "output_tokens" integer,
  "latency_ms" integer,
  "cost_idr" numeric(10,2),
  "validator_passed" boolean,
  "validator_flags" text[],
  "self_review_score" numeric(4,2),
  "retry_count" integer,
  "finish_reason" character varying(20),
  "teacher_satisfaction" smallint,
  "teacher_feedback" text,
  "generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.forum_post_acknowledgements (
  "post_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "school_id" uuid NOT NULL,
  "acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.forum_post_audience (
  "post_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "school_id" uuid NOT NULL,
  "added_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.forum_post_comments (
  "comment_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "post_id" uuid NOT NULL,
  "school_id" uuid NOT NULL,
  "author_user_id" uuid NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.forum_post_subjects (
  "post_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "school_id" uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.forum_posts (
  "post_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "class_id" uuid,
  "category_id" uuid,
  "author_user_id" uuid NOT NULL,
  "academic_year" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "visibility" text DEFAULT 'INTERNAL'::text NOT NULL,
  "is_pinned" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "is_withdrawn" boolean DEFAULT false NOT NULL,
  "audience_type" text,
  "audience_type_2" text,
  "scope_type" text DEFAULT 'KELAS'::text NOT NULL,
  "attachment_url" text,
  "attachment_name" text,
  "is_edited" boolean DEFAULT false NOT NULL,
  "edited_at" timestamp with time zone,
  "deleted_at" timestamp with time zone,
  "attachment_path" text,
  "idempotency_key" uuid
);
CREATE TABLE IF NOT EXISTS public.generation_jobs (
  "job_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "teacher_user_id" uuid NOT NULL,
  "doc_id" uuid,
  "idempotency_key" character varying(100) NOT NULL,
  "generation_params_hash" character varying(64),
  "status" character varying(20) DEFAULT 'QUEUED'::character varying NOT NULL,
  "retry_count" integer DEFAULT 0 NOT NULL,
  "max_retry" integer DEFAULT 2 NOT NULL,
  "last_error" text,
  "context_snapshot" jsonb,
  "prompt_template_id" uuid,
  "provider" character varying(20),
  "model" character varying(50),
  "queued_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "failed_at" timestamp with time zone,
  "input_tokens" integer,
  "output_tokens" integer,
  "cost_idr" numeric(10,2)
);
CREATE TABLE IF NOT EXISTS public.grade_recap (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "class_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "learning_objective_id" uuid NOT NULL,
  "semester" integer NOT NULL,
  "academic_year" text NOT NULL,
  "nilai_akhir" numeric(5,2),
  "kktp_tercapai" boolean,
  "deskripsi_capaian" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.guru_wali_assignments (
  "assignment_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "guru_user_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "academic_year" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
  "assigned_by_user_id" uuid
);
CREATE TABLE IF NOT EXISTS public.late_arrivals (
  "late_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "recorded_by" uuid NOT NULL,
  "late_date" date DEFAULT CURRENT_DATE NOT NULL,
  "arrival_time" time without time zone NOT NULL,
  "reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.ld_context_snapshots (
  "snapshot_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "class_id" uuid NOT NULL,
  "teaching_assignment_id" uuid,
  "semester" character varying NOT NULL,
  "academic_year" character varying NOT NULL,
  "student_count" integer,
  "attendance_rate" numeric(5,2),
  "avg_assessment_score" numeric(5,2),
  "dominant_strengths" jsonb DEFAULT '[]'::jsonb,
  "dominant_challenges" jsonb DEFAULT '[]'::jsonb,
  "preferred_learning_modes" jsonb DEFAULT '[]'::jsonb,
  "industry_readiness_notes" text,
  "generated_at" timestamp with time zone DEFAULT now(),
  "created_by" uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.ld_document_nodes (
  "node_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL,
  "parent_node_id" uuid,
  "node_type" ld_node_type NOT NULL,
  "title" character varying,
  "content_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "content_text" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "generation_source" ld_generation_source DEFAULT 'AI'::ld_generation_source NOT NULL,
  "prompt_template_id" uuid,
  "prompt_version" integer,
  "last_edited_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ld_document_tp_links (
  "link_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL,
  "node_id" uuid,
  "tp_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ld_document_versions (
  "version_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "snapshot_json" jsonb NOT NULL,
  "published_by" uuid NOT NULL,
  "published_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ld_documents (
  "document_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "created_by" uuid NOT NULL,
  "teaching_assignment_id" uuid,
  "subject_id" uuid,
  "program_id" uuid,
  "class_id" uuid,
  "fase" character varying,
  "semester" character varying,
  "academic_year" character varying,
  "document_type" ld_document_type NOT NULL,
  "title" character varying NOT NULL,
  "status" ld_document_status DEFAULT 'draft'::ld_document_status NOT NULL,
  "latest_published_version" integer,
  "context_snapshot_id" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ld_program_knowledge_national (
  "knowledge_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "program_code" character varying NOT NULL,
  "program_name" character varying NOT NULL,
  "bidang_keahlian" character varying,
  "program_keahlian" character varying,
  "kompetensi_keahlian" character varying,
  "deskripsi" text,
  "kompetensi_inti" jsonb DEFAULT '[]'::jsonb,
  "capaian_lulusan" text,
  "istilah_teknis" jsonb DEFAULT '[]'::jsonb,
  "peralatan_umum" jsonb DEFAULT '[]'::jsonb,
  "software_umum" jsonb DEFAULT '[]'::jsonb,
  "standar_industri" jsonb DEFAULT '[]'::jsonb,
  "k3" jsonb DEFAULT '[]'::jsonb,
  "contoh_proyek" jsonb DEFAULT '[]'::jsonb,
  "contoh_produk" jsonb DEFAULT '[]'::jsonb,
  "contoh_dudi" jsonb DEFAULT '[]'::jsonb,
  "sertifikasi" jsonb DEFAULT '[]'::jsonb,
  "tren_teknologi" jsonb DEFAULT '[]'::jsonb,
  "referensi_pembelajaran" jsonb DEFAULT '[]'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ld_program_knowledge_school (
  "knowledge_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "program_id" uuid NOT NULL,
  "software_sekolah" jsonb DEFAULT '[]'::jsonb,
  "peralatan_sekolah" jsonb DEFAULT '[]'::jsonb,
  "teaching_factory" jsonb DEFAULT '[]'::jsonb,
  "mitra_pkl" jsonb DEFAULT '[]'::jsonb,
  "produk_unggulan" jsonb DEFAULT '[]'::jsonb,
  "budaya_kerja" jsonb DEFAULT '[]'::jsonb,
  "proyek_sekolah" jsonb DEFAULT '[]'::jsonb,
  "catatan_tambahan" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ld_prompt_templates (
  "template_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "node_type" ld_node_type NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "label" character varying,
  "system_prompt" text NOT NULL,
  "user_prompt_template" text NOT NULL,
  "context_layers" jsonb DEFAULT '["national", "school", "teacher", "class"]'::jsonb,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ld_teacher_knowledge (
  "knowledge_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "teacher_id" uuid NOT NULL,
  "program_id" uuid,
  "subject_id" uuid,
  "pendekatan_favorit" jsonb DEFAULT '[]'::jsonb,
  "software_diajarkan" jsonb DEFAULT '[]'::jsonb,
  "contoh_kasus" jsonb DEFAULT '[]'::jsonb,
  "urutan_materi_custom" text,
  "proyek_andalan" jsonb DEFAULT '[]'::jsonb,
  "catatan_gaya_mengajar" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.learning_objectives (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "teacher_id" uuid NOT NULL,
  "class_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "academic_year" character varying(9) NOT NULL,
  "semester" integer NOT NULL,
  "kode_tp" text NOT NULL,
  "deskripsi_tp" text NOT NULL,
  "urutan" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.login_devices (
  "device_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "school_id" uuid NOT NULL,
  "device_hash" text NOT NULL,
  "user_agent" text DEFAULT ''::text NOT NULL,
  "label" text DEFAULT ''::text NOT NULL,
  "first_seen" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.notifications (
  "notification_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "recipient_user_id" uuid NOT NULL,
  "case_id" uuid,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "body" text DEFAULT ''::text NOT NULL,
  "is_read" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "forum_post_id" uuid,
  "forum_comment_id" uuid,
  "late_arrival_id" uuid
);
CREATE TABLE IF NOT EXISTS public.observations (
  "observation_id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "student_id" uuid NOT NULL,
  "author_user_id" uuid NOT NULL,
  "sentiment" observation_sentiment NOT NULL,
  "dimension" observation_dimension NOT NULL,
  "content" text NOT NULL,
  "visibility" visibility_level NOT NULL,
  "visibility_override_flag" boolean DEFAULT false NOT NULL,
  "class_id" uuid,
  "schedule_id" uuid,
  "observed_at" date DEFAULT CURRENT_DATE NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "school_id" uuid NOT NULL,
  "is_void" boolean DEFAULT false NOT NULL,
  "void_reason" text,
  "voided_by" uuid,
  "voided_at" timestamp with time zone
);
CREATE TABLE IF NOT EXISTS public.pending_auth_deletions (
  "queue_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "purge_student_id" uuid NOT NULL,
  "auth_user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone,
  "last_error" text
);
CREATE TABLE IF NOT EXISTS public.pkl_attendance (
  "pkl_attendance_id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "placement_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "attendance_date" date DEFAULT CURRENT_DATE NOT NULL,
  "status" attendance_status DEFAULT 'HADIR'::attendance_status NOT NULL,
  "check_in_time" time without time zone,
  "check_out_time" time without time zone,
  "notes" text,
  "recorded_by_user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "school_id" uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.pkl_placements (
  "placement_id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "student_id" uuid NOT NULL,
  "dudi_user_id" uuid NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "school_id" uuid NOT NULL,
  "guru_pembimbing_user_id" uuid
);
CREATE TABLE IF NOT EXISTS public.platform_config (
  "id" smallint DEFAULT 1 NOT NULL,
  "maintenance_active" boolean DEFAULT false NOT NULL,
  "maintenance_message" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.programs (
  "program_id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "code" character varying(20) NOT NULL,
  "name" character varying(100) NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "school_id" uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.prompt_templates (
  "template_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "document_type" character varying(30) NOT NULL,
  "provider" character varying(20) NOT NULL,
  "template_version" character varying(20) NOT NULL,
  "formatter_version" character varying(20) NOT NULL,
  "system_instruction_v" character varying(20) NOT NULL,
  "system_instruction" text NOT NULL,
  "core_prompt" text NOT NULL,
  "formatter_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "deprecated_at" timestamp with time zone,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.schedule_reapply_jobs (
  "job_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "academic_year" text NOT NULL,
  "semester" semester NOT NULL,
  "status" text DEFAULT 'PENDING'::text NOT NULL,
  "total_to_delete" integer DEFAULT 0 NOT NULL,
  "deleted_count" integer DEFAULT 0 NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "error_message" text,
  "created_by" uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.schedule_reapply_targets (
  "target_id" bigint GENERATED ALWAYS AS IDENTITY,
  "job_id" uuid NOT NULL,
  "school_id" uuid NOT NULL,
  "schedule_id" uuid NOT NULL,
  "deleted_at" timestamp with time zone
);
CREATE TABLE IF NOT EXISTS public.schedule_templates (
  "template_id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "academic_year" character varying(9) NOT NULL,
  "semester" semester NOT NULL,
  "day_of_week" day_of_week NOT NULL,
  "start_time" time without time zone NOT NULL,
  "end_time" time without time zone NOT NULL,
  "class_id" uuid NOT NULL,
  "teacher_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "subject_id" uuid,
  "subject_label" character varying(50),
  "school_id" uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.schedule_time_slots (
  "slot_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "academic_year" character varying(9) NOT NULL,
  "semester" semester NOT NULL,
  "day_of_week" day_of_week NOT NULL,
  "slot_number" integer NOT NULL,
  "start_time" time without time zone NOT NULL,
  "end_time" time without time zone NOT NULL,
  "is_break" boolean DEFAULT false NOT NULL,
  "break_label" character varying(50),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "school_id" uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.school_config (
  "config_id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "school_name" character varying(150) NOT NULL,
  "setup_completed" boolean DEFAULT false NOT NULL,
  "current_academic_year" character varying(9),
  "current_semester" semester,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "address" text,
  "password_changed" boolean DEFAULT false NOT NULL,
  "school_id" uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.schools (
  "school_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "npsn" text,
  "address" text,
  "phone" text,
  "logo_url" text,
  "primary_color" text DEFAULT '#1a56db'::text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "slug" text,
  "secondary_color" text DEFAULT '#1e40af'::text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.student_exits (
  "exit_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "exit_date" date DEFAULT ((now() AT TIME ZONE 'Asia/Jakarta'::text))::date NOT NULL,
  "exit_time" time without time zone NOT NULL,
  "return_time" time without time zone,
  "reason" text,
  "recorded_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.student_grades (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "assessment_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "school_id" uuid NOT NULL,
  "teacher_id" uuid NOT NULL,
  "judul" text,
  "nilai_angka" numeric(5,2),
  "deskripsi" text,
  "tindak_lanjut" text,
  "is_published" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.student_groups (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "class_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "grup" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.student_parents (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "student_id" uuid NOT NULL,
  "parent_user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "school_id" uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.student_updates (
  "update_id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "case_id" uuid NOT NULL,
  "author_user_id" uuid NOT NULL,
  "content" text NOT NULL,
  "case_event_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "school_id" uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.students (
  "student_id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "nis" character varying(20) NOT NULL,
  "full_name" character varying(150) NOT NULL,
  "program_id" uuid NOT NULL,
  "student_status" student_status DEFAULT 'AKTIF'::student_status NOT NULL,
  "user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "graduated_at" timestamp with time zone,
  "graduated_academic_year" character varying(9),
  "school_id" uuid NOT NULL,
  "alumni_career_track" text,
  "alumni_career_note" text,
  "keluar_at" timestamp with time zone,
  "keluar_note" text,
  "anonymized_at" timestamp with time zone
);
CREATE TABLE IF NOT EXISTS public.subject_code_aliases (
  "alias_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "kode" character varying(30) NOT NULL,
  "core_subject_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "nama" text,
  "jurusan" text,
  "kelas" text
);
CREATE TABLE IF NOT EXISTS public.subject_cp_mapping (
  "mapping_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "program_id" uuid,
  "core_subject_id" uuid NOT NULL,
  "mapping_type" character varying(10) DEFAULT 'MANUAL'::character varying NOT NULL,
  "is_active" boolean DEFAULT true,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.subjects (
  "subject_id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "code" character varying(20) NOT NULL,
  "name" character varying(100) NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "school_id" uuid NOT NULL,
  "kelompok_mapel" character varying(20),
  "fase_default" character varying(1)
);
CREATE TABLE IF NOT EXISTS public.substitute_schedules (
  "substitute_id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "schedule_id" uuid NOT NULL,
  "substitute_user_id" uuid NOT NULL,
  "granted_by_user_id" uuid NOT NULL,
  "granted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sync_token" text DEFAULT encode(gen_random_bytes(32), 'hex'::text) NOT NULL,
  "sync_token_expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "school_id" uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.sync_idempotency (
  "idempotency_key" text NOT NULL,
  "function_name" character varying(100) NOT NULL,
  "result_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "school_id" uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.teacher_attendance_log (
  "log_id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "schedule_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "activity_type" character varying(50) NOT NULL,
  "activity_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "school_id" uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.teacher_document_approvals (
  "approval_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "doc_id" uuid NOT NULL,
  "school_id" uuid NOT NULL,
  "approved_by" uuid NOT NULL,
  "status" character varying(20) NOT NULL,
  "catatan" text,
  "approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.teacher_document_classes (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "doc_id" uuid NOT NULL,
  "class_id" uuid NOT NULL,
  "school_id" uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.teacher_documents (
  "doc_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "teacher_user_id" uuid NOT NULL,
  "academic_year" character varying(10) NOT NULL,
  "document_type" character varying(30) NOT NULL,
  "core_subject_id" uuid NOT NULL,
  "phase_id" uuid NOT NULL,
  "program_id" uuid,
  "scope_type" character varying(20) NOT NULL,
  "parent_doc_id" uuid,
  "semester" smallint,
  "tp_urutan" integer,
  "status" character varying(30) DEFAULT 'AI_DRAFT'::character varying NOT NULL,
  "content_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "docx_url" text,
  "pdf_url" text,
  "curriculum_version" character varying(20),
  "knowledge_version" character varying(20),
  "generation_policy_version" character varying(20),
  "model_version" character varying(50),
  "generated_at" timestamp with time zone,
  "context_snapshot" jsonb,
  "source_doc_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.teacher_journals (
  "journal_id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "entry_date" date DEFAULT CURRENT_DATE NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "school_id" uuid NOT NULL,
  "kondisi_kelas" character varying(20),
  "catatan_tambahan" text,
  "tindak_lanjut" text
);
CREATE TABLE IF NOT EXISTS public.teacher_piket_assignments (
  "assignment_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "school_id" uuid NOT NULL,
  "day_of_week" smallint NOT NULL,
  "academic_year" character varying NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.teacher_profiles (
  "profile_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "teacher_user_id" uuid NOT NULL,
  "instructional_intent" character varying(50),
  "intent_detail" text,
  "assessment_philosophy" character varying(50),
  "teaching_style" character varying(30),
  "learning_model" character varying(50),
  "delivery_style" character varying(50),
  "schedule_pattern" character varying(50),
  "project_duration" character varying(30),
  "depth_level" character varying(20),
  "local_city" text,
  "local_industry" text,
  "local_dudi_partners" text,
  "local_products" text,
  "avoided_activities" text[],
  "avoided_detail" text,
  "integration_prefs" text[],
  "last_refreshed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.teaching_assignments (
  "assignment_id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "user_id" uuid NOT NULL,
  "class_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "academic_year" character varying(9) NOT NULL,
  "semester" semester NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "school_id" uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.teaching_contexts (
  "context_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "teacher_user_id" uuid NOT NULL,
  "academic_year" character varying(10) NOT NULL,
  "subject_id" uuid,
  "class_id" uuid,
  "student_background" character varying(50),
  "tech_access" character varying(50),
  "daily_language" text,
  "class_characteristics" text[],
  "student_autonomy" character varying(30),
  "learning_constraints" text[],
  "constraints_detail" text,
  "resources_available" text[],
  "dudi_name" text,
  "narasumber_detail" text,
  "expected_output" character varying(50),
  "output_detail" text,
  "school_habits" text[],
  "habits_detail" text,
  "media_available" text[],
  "media_detail" text,
  "last_refreshed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.teaching_cp (
  "cp_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "teacher_id" uuid NOT NULL,
  "class_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "academic_year" character varying NOT NULL,
  "cp_umum" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.teaching_cp_elements (
  "element_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "cp_id" uuid NOT NULL,
  "school_id" uuid NOT NULL,
  "teacher_id" uuid NOT NULL,
  "nama_elemen" text NOT NULL,
  "deskripsi_cp" text NOT NULL,
  "urutan" smallint DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.teaching_schedules (
  "schedule_id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "assignment_id" uuid,
  "class_id" uuid NOT NULL,
  "subject_id" uuid,
  "scheduled_teacher_id" uuid NOT NULL,
  "session_date" date NOT NULL,
  "session_start" time without time zone NOT NULL,
  "session_end" time without time zone NOT NULL,
  "meeting_status" meeting_status DEFAULT 'NORMAL'::meeting_status NOT NULL,
  "teacher_indicator" teacher_attendance_indicator DEFAULT 'PENDING_EVALUATION'::teacher_attendance_indicator NOT NULL,
  "academic_year" character varying(9) NOT NULL,
  "semester" semester NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "school_id" uuid NOT NULL,
  "subject_label" character varying(50),
  "block_group_id" uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.tp_taught_status (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "teacher_id" uuid NOT NULL,
  "class_id" uuid NOT NULL,
  "tp_id" text NOT NULL,
  "school_id" uuid NOT NULL,
  "is_taught" boolean DEFAULT false NOT NULL,
  "taught_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.tujuan_pembelajaran (
  "tp_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "cp_id" uuid,
  "subject_id" uuid NOT NULL,
  "program_id" uuid,
  "fase" character varying(1) NOT NULL,
  "semester" integer NOT NULL,
  "urutan" integer NOT NULL,
  "kode_tp" character varying(30),
  "deskripsi_tp" text NOT NULL,
  "materi_pokok" text,
  "alokasi_jp" integer,
  "indikator" text[],
  "generated_by" character varying(10) DEFAULT 'MANUAL'::character varying NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.users (
  "user_id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "auth_user_id" uuid NOT NULL,
  "full_name" character varying(150) NOT NULL,
  "email" character varying(254) NOT NULL,
  "login_identifier" character varying(100) NOT NULL,
  "identifier_type" character varying(20) NOT NULL,
  "role_type" role_type NOT NULL,
  "program_id" uuid,
  "wali_kelas_class_id" uuid,
  "dudi_org_name" character varying(150),
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "teacher_code" character varying(20),
  "kaprodi_program_id" uuid,
  "is_bk" boolean DEFAULT false NOT NULL,
  "is_kepsek" boolean DEFAULT false NOT NULL,
  "is_waka_kurikulum" boolean DEFAULT false NOT NULL,
  "is_waka_kesiswaan" boolean DEFAULT false NOT NULL,
  "school_id" uuid NOT NULL,
  "must_change_password" boolean DEFAULT false NOT NULL,
  "last_seen_at" timestamp with time zone,
  "last_seen_ua" text,
  "deleted_at" timestamp with time zone,
  "is_waka_humas" boolean DEFAULT false NOT NULL,
  "password_changed_at" timestamp with time zone,
  "allow_parallel_teaching" boolean DEFAULT false NOT NULL
);

-- ============================================================
-- Constraint: primary key, unique, check, exclusion
-- ============================================================
DO $$ BEGIN ALTER TABLE core.capaian_pembelajaran ADD CONSTRAINT "capaian_pembelajaran_pkey" PRIMARY KEY (cp_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.cp_elements ADD CONSTRAINT "cp_elements_pkey" PRIMARY KEY (element_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.curriculum_versions ADD CONSTRAINT "curriculum_versions_pkey" PRIMARY KEY (version_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.education_levels ADD CONSTRAINT "education_levels_pkey" PRIMARY KEY (level_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.knowledge_national ADD CONSTRAINT "knowledge_national_pkey" PRIMARY KEY (kn_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.phases ADD CONSTRAINT "phases_pkey" PRIMARY KEY (phase_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.subject_name_mapping ADD CONSTRAINT "subject_name_mapping_pkey" PRIMARY KEY (mapping_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.subject_phases ADD CONSTRAINT "subject_phases_pkey" PRIMARY KEY (subject_phase_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.subjects ADD CONSTRAINT "subjects_pkey" PRIMARY KEY (subject_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.vocational_concentrations ADD CONSTRAINT "vocational_concentrations_pkey" PRIMARY KEY (concentration_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.vocational_fields ADD CONSTRAINT "vocational_fields_pkey" PRIMARY KEY (field_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.vocational_programs ADD CONSTRAINT "vocational_programs_pkey" PRIMARY KEY (program_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.academic_periods ADD CONSTRAINT "academic_periods_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessment_criteria ADD CONSTRAINT "assessment_criteria_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessment_results ADD CONSTRAINT "assessment_results_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessment_rubric_criteria ADD CONSTRAINT "assessment_rubric_criteria_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessment_rubric_results ADD CONSTRAINT "assessment_rubric_results_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessments ADD CONSTRAINT "assessments_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.attendance ADD CONSTRAINT "attendance_pkey" PRIMARY KEY (attendance_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.audit_log ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.bk_class_assignments ADD CONSTRAINT "bk_class_assignments_pkey" PRIMARY KEY (assignment_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.capaian_pembelajaran ADD CONSTRAINT "capaian_pembelajaran_pkey" PRIMARY KEY (cp_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.class_enrollments ADD CONSTRAINT "class_enrollments_pkey" PRIMARY KEY (enrollment_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.classes ADD CONSTRAINT "classes_pkey" PRIMARY KEY (class_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.coaching_case_events ADD CONSTRAINT "coaching_case_events_pkey" PRIMARY KEY (event_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.coaching_case_handlers ADD CONSTRAINT "coaching_case_handlers_pkey" PRIMARY KEY (handler_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.coaching_case_templates ADD CONSTRAINT "coaching_case_templates_pkey" PRIMARY KEY (template_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.coaching_cases ADD CONSTRAINT "coaching_cases_pkey" PRIMARY KEY (case_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.communication_categories ADD CONSTRAINT "communication_categories_pkey" PRIMARY KEY (category_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.duty_schedules ADD CONSTRAINT "duty_schedules_pkey" PRIMARY KEY (duty_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.evaluation_logs ADD CONSTRAINT "evaluation_logs_pkey" PRIMARY KEY (log_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_post_acknowledgements ADD CONSTRAINT "forum_post_acknowledgements_pkey" PRIMARY KEY (post_id, user_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_post_audience ADD CONSTRAINT "forum_post_audience_pkey" PRIMARY KEY (post_id, user_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_post_comments ADD CONSTRAINT "forum_post_comments_pkey" PRIMARY KEY (comment_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_post_subjects ADD CONSTRAINT "forum_post_subjects_pkey" PRIMARY KEY (post_id, student_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_posts ADD CONSTRAINT "forum_posts_pkey" PRIMARY KEY (post_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.generation_jobs ADD CONSTRAINT "generation_jobs_pkey" PRIMARY KEY (job_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.grade_recap ADD CONSTRAINT "grade_recap_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.guru_wali_assignments ADD CONSTRAINT "guru_wali_assignments_pkey" PRIMARY KEY (assignment_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.late_arrivals ADD CONSTRAINT "late_arrivals_pkey" PRIMARY KEY (late_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_context_snapshots ADD CONSTRAINT "ld_context_snapshots_pkey" PRIMARY KEY (snapshot_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_document_nodes ADD CONSTRAINT "ld_document_nodes_pkey" PRIMARY KEY (node_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_document_tp_links ADD CONSTRAINT "ld_document_tp_links_pkey" PRIMARY KEY (link_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_document_versions ADD CONSTRAINT "ld_document_versions_pkey" PRIMARY KEY (version_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_documents ADD CONSTRAINT "ld_documents_pkey" PRIMARY KEY (document_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_program_knowledge_national ADD CONSTRAINT "ld_program_knowledge_national_pkey" PRIMARY KEY (knowledge_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_program_knowledge_school ADD CONSTRAINT "ld_program_knowledge_school_pkey" PRIMARY KEY (knowledge_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_prompt_templates ADD CONSTRAINT "ld_prompt_templates_pkey" PRIMARY KEY (template_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_teacher_knowledge ADD CONSTRAINT "ld_teacher_knowledge_pkey" PRIMARY KEY (knowledge_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.learning_objectives ADD CONSTRAINT "learning_objectives_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.login_devices ADD CONSTRAINT "login_devices_pkey" PRIMARY KEY (device_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.notifications ADD CONSTRAINT "notifications_pkey" PRIMARY KEY (notification_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.observations ADD CONSTRAINT "observations_pkey" PRIMARY KEY (observation_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.pending_auth_deletions ADD CONSTRAINT "pending_auth_deletions_pkey" PRIMARY KEY (queue_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.pkl_attendance ADD CONSTRAINT "pkl_attendance_pkey" PRIMARY KEY (pkl_attendance_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.pkl_placements ADD CONSTRAINT "pkl_placements_pkey" PRIMARY KEY (placement_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.platform_config ADD CONSTRAINT "platform_config_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.programs ADD CONSTRAINT "programs_pkey" PRIMARY KEY (program_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.prompt_templates ADD CONSTRAINT "prompt_templates_pkey" PRIMARY KEY (template_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.schedule_reapply_jobs ADD CONSTRAINT "schedule_reapply_jobs_pkey" PRIMARY KEY (job_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.schedule_reapply_targets ADD CONSTRAINT "schedule_reapply_targets_pkey" PRIMARY KEY (target_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.schedule_templates ADD CONSTRAINT "schedule_templates_pkey" PRIMARY KEY (template_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.schedule_time_slots ADD CONSTRAINT "schedule_time_slots_pkey" PRIMARY KEY (slot_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.school_config ADD CONSTRAINT "school_config_pkey" PRIMARY KEY (config_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.schools ADD CONSTRAINT "schools_pkey" PRIMARY KEY (school_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_exits ADD CONSTRAINT "student_exits_pkey" PRIMARY KEY (exit_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_grades ADD CONSTRAINT "student_grades_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_groups ADD CONSTRAINT "student_groups_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_parents ADD CONSTRAINT "student_parents_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_updates ADD CONSTRAINT "student_updates_pkey" PRIMARY KEY (update_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.students ADD CONSTRAINT "students_pkey" PRIMARY KEY (student_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.subject_code_aliases ADD CONSTRAINT "subject_code_aliases_pkey" PRIMARY KEY (alias_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.subject_cp_mapping ADD CONSTRAINT "subject_cp_mapping_pkey" PRIMARY KEY (mapping_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.subjects ADD CONSTRAINT "subjects_pkey" PRIMARY KEY (subject_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.substitute_schedules ADD CONSTRAINT "substitute_schedules_pkey" PRIMARY KEY (substitute_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.sync_idempotency ADD CONSTRAINT "sync_idempotency_pkey" PRIMARY KEY (idempotency_key); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_attendance_log ADD CONSTRAINT "teacher_attendance_log_pkey" PRIMARY KEY (log_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_document_approvals ADD CONSTRAINT "teacher_document_approvals_pkey" PRIMARY KEY (approval_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_document_classes ADD CONSTRAINT "teacher_document_classes_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_documents ADD CONSTRAINT "teacher_documents_pkey" PRIMARY KEY (doc_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_journals ADD CONSTRAINT "teacher_journals_pkey" PRIMARY KEY (journal_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_piket_assignments ADD CONSTRAINT "teacher_piket_assignments_pkey" PRIMARY KEY (assignment_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_profiles ADD CONSTRAINT "teacher_profiles_pkey" PRIMARY KEY (profile_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teaching_assignments ADD CONSTRAINT "teaching_assignments_pkey" PRIMARY KEY (assignment_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teaching_contexts ADD CONSTRAINT "teaching_contexts_pkey" PRIMARY KEY (context_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teaching_cp ADD CONSTRAINT "teaching_cp_pkey" PRIMARY KEY (cp_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teaching_cp_elements ADD CONSTRAINT "teaching_cp_elements_pkey" PRIMARY KEY (element_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teaching_schedules ADD CONSTRAINT "teaching_schedules_pkey" PRIMARY KEY (schedule_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.tp_taught_status ADD CONSTRAINT "tp_taught_status_pkey" PRIMARY KEY (id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.tujuan_pembelajaran ADD CONSTRAINT "tujuan_pembelajaran_pkey" PRIMARY KEY (tp_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.users ADD CONSTRAINT "users_pkey" PRIMARY KEY (user_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.capaian_pembelajaran ADD CONSTRAINT "capaian_pembelajaran_subject_phase_id_version_id_key" UNIQUE (subject_phase_id, version_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.cp_elements ADD CONSTRAINT "cp_elements_cp_id_element_order_key" UNIQUE (cp_id, element_order); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.curriculum_versions ADD CONSTRAINT "curriculum_versions_version_code_key" UNIQUE (version_code); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.education_levels ADD CONSTRAINT "education_levels_code_key" UNIQUE (code); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.phases ADD CONSTRAINT "phases_level_id_code_key" UNIQUE (level_id, code); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.subject_name_mapping ADD CONSTRAINT "uq_subject_name_mapping" UNIQUE NULLS NOT DISTINCT (kode_pattern, program_hint, grade_level); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.subject_phases ADD CONSTRAINT "subject_phases_subject_id_phase_id_version_id_key" UNIQUE (subject_id, phase_id, version_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.subjects ADD CONSTRAINT "subjects_code_key" UNIQUE (code); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.vocational_concentrations ADD CONSTRAINT "vocational_concentrations_code_key" UNIQUE (code); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.vocational_fields ADD CONSTRAINT "vocational_fields_code_key" UNIQUE (code); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.vocational_programs ADD CONSTRAINT "vocational_programs_code_key" UNIQUE (code); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.academic_periods ADD CONSTRAINT "uq_academic_period" UNIQUE (school_id, academic_year, semester); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessment_criteria ADD CONSTRAINT "uq_ac_per_lo" UNIQUE (learning_objective_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessment_results ADD CONSTRAINT "assessment_results_assessment_id_student_id_key" UNIQUE (assessment_id, student_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessment_rubric_results ADD CONSTRAINT "assessment_rubric_results_criteria_id_student_id_key" UNIQUE (criteria_id, student_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.attendance ADD CONSTRAINT "uq_attendance_per_session" UNIQUE (schedule_id, student_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.bk_class_assignments ADD CONSTRAINT "uq_bk_class_year" UNIQUE (school_id, bk_user_id, class_id, academic_year); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.capaian_pembelajaran ADD CONSTRAINT "uq_cp" UNIQUE (school_id, subject_id, program_id, fase, elemen); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.class_enrollments ADD CONSTRAINT "uq_enrollment_per_period" UNIQUE (student_id, academic_year, semester); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.classes ADD CONSTRAINT "uq_classes_school_name_year" UNIQUE (school_id, name, academic_year); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.communication_categories ADD CONSTRAINT "communication_categories_category_code_key" UNIQUE (category_code); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.duty_schedules ADD CONSTRAINT "duty_schedules_school_id_user_id_day_of_week_academic_year__key" UNIQUE (school_id, user_id, day_of_week, academic_year, semester); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.generation_jobs ADD CONSTRAINT "generation_jobs_idempotency_key_key" UNIQUE (idempotency_key); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.grade_recap ADD CONSTRAINT "grade_recap_school_id_class_id_student_id_learning_objectiv_key" UNIQUE (school_id, class_id, student_id, learning_objective_id, semester, academic_year); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.guru_wali_assignments ADD CONSTRAINT "uq_guru_wali_student_year" UNIQUE (school_id, student_id, academic_year); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_context_snapshots ADD CONSTRAINT "ld_context_snapshots_school_id_class_id_teaching_assignment_key" UNIQUE (school_id, class_id, teaching_assignment_id, semester, academic_year); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_document_tp_links ADD CONSTRAINT "ld_document_tp_links_document_id_node_id_tp_id_key" UNIQUE (document_id, node_id, tp_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_document_versions ADD CONSTRAINT "ld_document_versions_document_id_version_number_key" UNIQUE (document_id, version_number); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_program_knowledge_national ADD CONSTRAINT "ld_program_knowledge_national_program_code_key" UNIQUE (program_code); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_program_knowledge_school ADD CONSTRAINT "ld_program_knowledge_school_school_id_program_id_key" UNIQUE (school_id, program_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_prompt_templates ADD CONSTRAINT "ld_prompt_templates_node_type_version_key" UNIQUE (node_type, version); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_teacher_knowledge ADD CONSTRAINT "ld_teacher_knowledge_teacher_id_program_id_subject_id_key" UNIQUE (teacher_id, program_id, subject_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.learning_objectives ADD CONSTRAINT "learning_objectives_school_id_class_id_subject_id_academic__key" UNIQUE (school_id, class_id, subject_id, academic_year, semester, kode_tp); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.login_devices ADD CONSTRAINT "login_devices_user_id_device_hash_key" UNIQUE (user_id, device_hash); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.pending_auth_deletions ADD CONSTRAINT "pending_auth_deletions_auth_user_id_key" UNIQUE (auth_user_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.pkl_attendance ADD CONSTRAINT "uq_pkl_attendance_per_day" UNIQUE (placement_id, attendance_date); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.programs ADD CONSTRAINT "uq_programs_school_code" UNIQUE (school_id, code); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.prompt_templates ADD CONSTRAINT "prompt_templates_document_type_provider_template_version_key" UNIQUE (document_type, provider, template_version); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.schedule_reapply_targets ADD CONSTRAINT "ux_reapply_targets_job_schedule" UNIQUE (job_id, schedule_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.schedule_templates ADD CONSTRAINT "uq_schedule_template_slot" UNIQUE (academic_year, semester, day_of_week, start_time, class_id, teacher_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.schedule_time_slots ADD CONSTRAINT "uq_slot_per_day" UNIQUE (school_id, academic_year, semester, day_of_week, slot_number); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.schools ADD CONSTRAINT "schools_npsn_key" UNIQUE (npsn); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.schools ADD CONSTRAINT "schools_slug_key" UNIQUE (slug); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_grades ADD CONSTRAINT "student_grades_assessment_id_student_id_key" UNIQUE (assessment_id, student_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_groups ADD CONSTRAINT "student_groups_class_id_student_id_key" UNIQUE (class_id, student_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_parents ADD CONSTRAINT "uq_student_parent" UNIQUE (student_id, parent_user_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.students ADD CONSTRAINT "students_user_id_key" UNIQUE (user_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.subject_code_aliases ADD CONSTRAINT "subject_code_aliases_school_id_kode_key" UNIQUE (school_id, kode); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.subject_cp_mapping ADD CONSTRAINT "subject_cp_mapping_school_id_subject_id_program_id_core_sub_key" UNIQUE NULLS NOT DISTINCT (school_id, subject_id, program_id, core_subject_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.subjects ADD CONSTRAINT "uq_subjects_school_code" UNIQUE (school_id, code); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.substitute_schedules ADD CONSTRAINT "uq_substitute_per_schedule" UNIQUE (schedule_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_document_approvals ADD CONSTRAINT "unique_doc_approval" UNIQUE (doc_id, status); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_document_classes ADD CONSTRAINT "teacher_document_classes_doc_id_class_id_key" UNIQUE (doc_id, class_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_piket_assignments ADD CONSTRAINT "teacher_piket_assignments_user_id_school_id_day_of_week_aca_key" UNIQUE (user_id, school_id, day_of_week, academic_year); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_profiles ADD CONSTRAINT "teacher_profiles_school_id_teacher_user_id_key" UNIQUE (school_id, teacher_user_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teaching_assignments ADD CONSTRAINT "uq_assignment" UNIQUE (user_id, class_id, subject_id, academic_year, semester); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teaching_contexts ADD CONSTRAINT "teaching_contexts_school_id_teacher_user_id_academic_year_s_key" UNIQUE (school_id, teacher_user_id, academic_year, subject_id, class_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teaching_cp ADD CONSTRAINT "teaching_cp_school_teacher_class_subject_year_key" UNIQUE (school_id, teacher_id, class_id, subject_id, academic_year); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teaching_schedules ADD CONSTRAINT "uq_teaching_schedule_slot" UNIQUE (class_id, scheduled_teacher_id, session_date, session_start); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.tp_taught_status ADD CONSTRAINT "tp_taught_status_teacher_id_class_id_tp_id_key" UNIQUE (teacher_id, class_id, tp_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.tujuan_pembelajaran ADD CONSTRAINT "uq_tp" UNIQUE (school_id, subject_id, program_id, fase, semester, urutan); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.users ADD CONSTRAINT "uq_users_school_login_identifier" UNIQUE (school_id, login_identifier); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.users ADD CONSTRAINT "uq_users_school_teacher_code" UNIQUE (school_id, teacher_code); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.users ADD CONSTRAINT "users_auth_user_id_key" UNIQUE (auth_user_id); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.users ADD CONSTRAINT "users_email_key" UNIQUE (email); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.knowledge_national ADD CONSTRAINT "knowledge_national_category_check" CHECK (((category)::text = ANY ((ARRAY['SOFTWARE_TOOLS'::character varying, 'SERTIFIKASI'::character varying, 'ISTILAH_TEKNIS'::character varying, 'CONTOH_PROYEK'::character varying, 'DUDI_UMUM'::character varying, 'STANDAR_KOMPETENSI'::character varying, 'BUDAYA_KERJA'::character varying])::text[]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.subject_name_mapping ADD CONSTRAINT "subject_name_mapping_confidence_check" CHECK (((confidence)::text = ANY ((ARRAY['HIGH'::character varying, 'MEDIUM'::character varying, 'LOW'::character varying])::text[]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.subjects ADD CONSTRAINT "subjects_subject_type_check" CHECK (((subject_type)::text = ANY ((ARRAY['UMUM'::character varying, 'KEJURUAN_LINTAS_PRODI'::character varying, 'KEJURUAN_DASAR'::character varying, 'KEJURUAN_KONSENTRASI'::character varying, 'KEJURUAN_PILIHAN'::character varying, 'PKL'::character varying, 'MUATAN_LOKAL'::character varying])::text[]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.academic_periods ADD CONSTRAINT "academic_periods_status_check" CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'CLOSED'::character varying])::text[]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.academic_periods ADD CONSTRAINT "chk_period_dates" CHECK ((end_date > start_date)); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessment_criteria ADD CONSTRAINT "assessment_criteria_batas_atas_check" CHECK ((batas_atas <= (100)::numeric)); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessment_criteria ADD CONSTRAINT "assessment_criteria_batas_bawah_check" CHECK ((batas_bawah >= (0)::numeric)); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessment_results ADD CONSTRAINT "assessment_results_nilai_range" CHECK (((nilai IS NULL) OR ((nilai >= (0)::numeric) AND (nilai <= (100)::numeric)))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessment_rubric_criteria ADD CONSTRAINT "assessment_rubric_criteria_bobot_check" CHECK (((bobot > (0)::numeric) AND (bobot <= (100)::numeric))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessments ADD CONSTRAINT "assessments_jenis_check" CHECK ((jenis = ANY (ARRAY['DIAGNOSTIK_NK'::text, 'DIAGNOSTIK_K'::text, 'FORMATIF'::text, 'SUMATIF'::text]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessments ADD CONSTRAINT "assessments_semester_check" CHECK ((semester = ANY (ARRAY[1, 2]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.attendance ADD CONSTRAINT "chk_void_reason" CHECK (((is_void = false) OR (void_reason IS NOT NULL))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.bk_class_assignments ADD CONSTRAINT "bk_class_assignments_academic_year_check" CHECK ((length(TRIM(BOTH FROM academic_year)) > 0)); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.capaian_pembelajaran ADD CONSTRAINT "capaian_pembelajaran_fase_check" CHECK (((fase)::text = ANY ((ARRAY['E'::character varying, 'F'::character varying])::text[]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.capaian_pembelajaran ADD CONSTRAINT "capaian_pembelajaran_generated_by_check" CHECK (((generated_by)::text = ANY ((ARRAY['AI'::character varying, 'MANUAL'::character varying])::text[]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.class_enrollments ADD CONSTRAINT "chk_withdrawal_after_enrollment" CHECK (((withdrawn_at IS NULL) OR (withdrawn_at > enrolled_at))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.classes ADD CONSTRAINT "classes_grade_level_check" CHECK (((grade_level >= 10) AND (grade_level <= 12))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.coaching_case_templates ADD CONSTRAINT "chk_cct_name_not_blank" CHECK ((TRIM(BOTH FROM name) <> ''::text)); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.coaching_cases ADD CONSTRAINT "chk_coaching_case_closed_meta" CHECK (((status <> 'CLOSED'::case_status) OR ((closed_at IS NOT NULL) AND (closed_by_user_id IS NOT NULL)))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.coaching_cases ADD CONSTRAINT "chk_coaching_case_title_not_blank" CHECK ((TRIM(BOTH FROM title) <> ''::text)); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.coaching_cases ADD CONSTRAINT "coaching_cases_description_check" CHECK ((length(description) >= 20)); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.communication_categories ADD CONSTRAINT "communication_categories_category_code_check" CHECK ((length(TRIM(BOTH FROM category_code)) > 0)); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.communication_categories ADD CONSTRAINT "communication_categories_label_sekolah_check" CHECK ((length(TRIM(BOTH FROM label_sekolah)) > 0)); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.communication_categories ADD CONSTRAINT "communication_categories_polarity_check" CHECK ((polarity = ANY (ARRAY['POSITIVE'::text, 'NEGATIVE'::text, 'NEUTRAL'::text]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.duty_schedules ADD CONSTRAINT "duty_schedules_semester_check" CHECK ((semester = ANY (ARRAY[1, 2]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.evaluation_logs ADD CONSTRAINT "evaluation_logs_teacher_satisfaction_check" CHECK (((teacher_satisfaction >= 1) AND (teacher_satisfaction <= 5))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_post_comments ADD CONSTRAINT "forum_post_comments_body_check" CHECK ((length(TRIM(BOTH FROM body)) >= 1)); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_posts ADD CONSTRAINT "chk_forum_posts_scope" CHECK ((((scope_type = 'KELAS'::text) AND (class_id IS NOT NULL)) OR ((scope_type = 'SEKOLAH'::text) AND (class_id IS NULL)))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_posts ADD CONSTRAINT "forum_posts_academic_year_check" CHECK ((length(TRIM(BOTH FROM academic_year)) > 0)); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_posts ADD CONSTRAINT "forum_posts_body_check" CHECK ((length(TRIM(BOTH FROM body)) >= 1)); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_posts ADD CONSTRAINT "forum_posts_scope_type_check" CHECK ((scope_type = ANY (ARRAY['KELAS'::text, 'SEKOLAH'::text]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_posts ADD CONSTRAINT "forum_posts_title_check" CHECK ((length(TRIM(BOTH FROM title)) >= 3)); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_posts ADD CONSTRAINT "forum_posts_visibility_check" CHECK ((visibility = ANY (ARRAY['INTERNAL'::text, 'PARENT_VISIBLE'::text]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.generation_jobs ADD CONSTRAINT "generation_jobs_status_check" CHECK (((status)::text = ANY ((ARRAY['QUEUED'::character varying, 'GENERATING'::character varying, 'VALIDATING'::character varying, 'RETRYING'::character varying, 'FAILED'::character varying, 'COMPLETED'::character varying])::text[]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.grade_recap ADD CONSTRAINT "grade_recap_nilai_akhir_range" CHECK (((nilai_akhir IS NULL) OR ((nilai_akhir >= (0)::numeric) AND (nilai_akhir <= (100)::numeric)))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.grade_recap ADD CONSTRAINT "grade_recap_semester_check" CHECK ((semester = ANY (ARRAY[1, 2]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.guru_wali_assignments ADD CONSTRAINT "guru_wali_assignments_academic_year_check" CHECK ((length(TRIM(BOTH FROM academic_year)) > 0)); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.learning_objectives ADD CONSTRAINT "learning_objectives_semester_check" CHECK ((semester = ANY (ARRAY[1, 2]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.notifications ADD CONSTRAINT "notifications_type_check" CHECK ((type = ANY (ARRAY['ESCALATION_DM'::text, 'CASE_BROADCAST'::text, 'LOGIN_NEW_DEVICE'::text, 'OBSERVATION_NEW'::text, 'CASE_RESTRICTED_NEW'::text, 'CASE_STUDENT_UPDATE'::text, 'FORUM_POST_NEW'::text, 'FORUM_COMMENT_NEW'::text, 'PERANGKAT_AJAR'::text, 'LATE_ARRIVAL'::text, 'EXIT_NOTIFICATION'::text]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.observations ADD CONSTRAINT "chk_content_not_blank" CHECK ((TRIM(BOTH FROM content) <> ''::text)); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.observations ADD CONSTRAINT "observations_content_check" CHECK (((length(content) >= 10) AND (length(content) <= 1000))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.pkl_attendance ADD CONSTRAINT "chk_pkl_checkout_after_checkin" CHECK (((check_out_time IS NULL) OR (check_in_time IS NULL) OR (check_out_time > check_in_time))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.pkl_placements ADD CONSTRAINT "chk_pkl_date_range" CHECK ((end_date > start_date)); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.platform_config ADD CONSTRAINT "platform_config_id_check" CHECK ((id = 1)); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.schedule_reapply_jobs ADD CONSTRAINT "chk_reapply_job_status" CHECK ((status = ANY (ARRAY['PENDING'::text, 'DELETING'::text, 'DELETED'::text, 'GENERATING'::text, 'DONE'::text, 'FAILED'::text]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.schedule_templates ADD CONSTRAINT "chk_schedule_time" CHECK ((end_time > start_time)); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.schedule_time_slots ADD CONSTRAINT "chk_break_label" CHECK (((is_break = false) OR (break_label IS NOT NULL))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.schedule_time_slots ADD CONSTRAINT "chk_slot_time" CHECK ((end_time > start_time)); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_grades ADD CONSTRAINT "student_grades_nilai_angka_range" CHECK (((nilai_angka IS NULL) OR ((nilai_angka >= (0)::numeric) AND (nilai_angka <= (100)::numeric)))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_grades ADD CONSTRAINT "student_grades_tindak_lanjut_check" CHECK ((tindak_lanjut = ANY (ARRAY['PENGAYAAN'::text, 'PENGUATAN'::text, 'PENDAMPINGAN'::text]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_groups ADD CONSTRAINT "student_groups_grup_check" CHECK ((grup = ANY (ARRAY['A'::text, 'B'::text, 'C'::text]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_updates ADD CONSTRAINT "student_updates_content_check" CHECK ((length(content) >= 10)); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.students ADD CONSTRAINT "chk_nis_not_empty" CHECK (((nis)::text <> ''::text)); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.students ADD CONSTRAINT "students_alumni_career_track_check" CHECK ((alumni_career_track = ANY (ARRAY['KULIAH'::text, 'KERJA'::text, 'WIRAUSAHA'::text, 'TIDAK_DIKETAHUI'::text]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.subject_cp_mapping ADD CONSTRAINT "subject_cp_mapping_mapping_type_check" CHECK (((mapping_type)::text = ANY ((ARRAY['AUTO'::character varying, 'MANUAL'::character varying])::text[]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.subjects ADD CONSTRAINT "subjects_fase_default_check" CHECK (((fase_default)::text = ANY ((ARRAY['E'::character varying, 'F'::character varying])::text[]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.subjects ADD CONSTRAINT "subjects_kelompok_mapel_check" CHECK (((kelompok_mapel)::text = ANY ((ARRAY['UMUM'::character varying, 'KEJURUAN'::character varying, 'PILIHAN'::character varying, 'MUATAN_LOKAL'::character varying])::text[]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_attendance_log ADD CONSTRAINT "teacher_attendance_log_activity_type_check" CHECK (((activity_type)::text = ANY ((ARRAY['ATTENDANCE_SUBMITTED'::character varying, 'OBSERVATION_CREATED'::character varying, 'JOURNAL_ENTRY_CREATED'::character varying, 'SUBSTITUTE_ATTENDANCE_SUBMITTED'::character varying])::text[]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_document_approvals ADD CONSTRAINT "teacher_document_approvals_status_check" CHECK (((status)::text = ANY ((ARRAY['APPROVED'::character varying, 'REJECTED'::character varying])::text[]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_documents ADD CONSTRAINT "teacher_documents_document_type_check" CHECK (((document_type)::text = ANY ((ARRAY['PROGRAM_TAHUNAN'::character varying, 'PROGRAM_SEMESTER'::character varying, 'ATP'::character varying, 'PPM'::character varying, 'LKPD'::character varying, 'SOAL'::character varying, 'RUBRIK'::character varying])::text[]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_documents ADD CONSTRAINT "teacher_documents_scope_type_check" CHECK (((scope_type)::text = ANY ((ARRAY['SEMUA_KELAS'::character varying, 'KELAS_TERTENTU'::character varying])::text[]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_documents ADD CONSTRAINT "teacher_documents_semester_check" CHECK ((semester = ANY (ARRAY[1, 2]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_documents ADD CONSTRAINT "teacher_documents_status_check" CHECK (((status)::text = ANY ((ARRAY['AI_DRAFT'::character varying, 'DIREVIEW_GURU'::character varying, 'MENUNGGU_WAKA'::character varying, 'DISAHKAN_WAKA'::character varying])::text[]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_journals ADD CONSTRAINT "teacher_journals_content_check" CHECK ((length(content) >= 1)); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_journals ADD CONSTRAINT "teacher_journals_kondisi_kelas_check" CHECK (((kondisi_kelas)::text = ANY ((ARRAY['SANGAT_BAIK'::character varying, 'BAIK'::character varying, 'CUKUP'::character varying, 'TERGANGGU'::character varying])::text[]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_piket_assignments ADD CONSTRAINT "teacher_piket_assignments_day_of_week_check" CHECK (((day_of_week >= 1) AND (day_of_week <= 6))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teaching_assignments ADD CONSTRAINT "chk_assignment_role" CHECK (true); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teaching_schedules ADD CONSTRAINT "chk_session_time" CHECK ((session_end > session_start)); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.tujuan_pembelajaran ADD CONSTRAINT "tujuan_pembelajaran_fase_check" CHECK (((fase)::text = ANY ((ARRAY['E'::character varying, 'F'::character varying])::text[]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.tujuan_pembelajaran ADD CONSTRAINT "tujuan_pembelajaran_generated_by_check" CHECK (((generated_by)::text = ANY ((ARRAY['AI'::character varying, 'MANUAL'::character varying])::text[]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.tujuan_pembelajaran ADD CONSTRAINT "tujuan_pembelajaran_semester_check" CHECK ((semester = ANY (ARRAY[1, 2]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.users ADD CONSTRAINT "chk_dudi_org_name" CHECK (((role_type <> 'DUDI'::role_type) OR (dudi_org_name IS NOT NULL))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.users ADD CONSTRAINT "chk_identifier_type" CHECK (((identifier_type)::text = ANY ((ARRAY['NIP'::character varying, 'NIS'::character varying, 'NIK'::character varying, 'NAMA_USAHA'::character varying, 'KODE_KHUSUS'::character varying])::text[]))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.users ADD CONSTRAINT "chk_wali_kelas_role" CHECK (((wali_kelas_class_id IS NULL) OR (role_type <> ALL (ARRAY['SISWA'::role_type, 'ORTU'::role_type, 'DUDI'::role_type, 'ADMINISTRATIVE'::role_type])))); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.pkl_placements ADD CONSTRAINT "uq_active_pkl_per_student" EXCLUDE USING gist (student_id WITH =, daterange(start_date, end_date) WITH &&) WHERE ((is_active = true)); EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

-- ============================================================
-- Constraint: foreign key
-- ============================================================
DO $$ BEGIN ALTER TABLE core.capaian_pembelajaran ADD CONSTRAINT "capaian_pembelajaran_subject_phase_id_fkey" FOREIGN KEY (subject_phase_id) REFERENCES core.subject_phases(subject_phase_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.capaian_pembelajaran ADD CONSTRAINT "capaian_pembelajaran_version_id_fkey" FOREIGN KEY (version_id) REFERENCES core.curriculum_versions(version_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.cp_elements ADD CONSTRAINT "cp_elements_cp_id_fkey" FOREIGN KEY (cp_id) REFERENCES core.capaian_pembelajaran(cp_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.knowledge_national ADD CONSTRAINT "knowledge_national_program_id_fkey" FOREIGN KEY (program_id) REFERENCES core.vocational_programs(program_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.knowledge_national ADD CONSTRAINT "knowledge_national_version_id_fkey" FOREIGN KEY (version_id) REFERENCES core.curriculum_versions(version_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.phases ADD CONSTRAINT "phases_level_id_fkey" FOREIGN KEY (level_id) REFERENCES core.education_levels(level_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.subject_name_mapping ADD CONSTRAINT "subject_name_mapping_core_subject_id_fkey" FOREIGN KEY (core_subject_id) REFERENCES core.subjects(subject_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.subject_phases ADD CONSTRAINT "subject_phases_phase_id_fkey" FOREIGN KEY (phase_id) REFERENCES core.phases(phase_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.subject_phases ADD CONSTRAINT "subject_phases_subject_id_fkey" FOREIGN KEY (subject_id) REFERENCES core.subjects(subject_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.subject_phases ADD CONSTRAINT "subject_phases_version_id_fkey" FOREIGN KEY (version_id) REFERENCES core.curriculum_versions(version_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.subjects ADD CONSTRAINT "subjects_concentration_id_fkey" FOREIGN KEY (concentration_id) REFERENCES core.vocational_concentrations(concentration_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.subjects ADD CONSTRAINT "subjects_program_id_fkey" FOREIGN KEY (program_id) REFERENCES core.vocational_programs(program_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.vocational_concentrations ADD CONSTRAINT "vocational_concentrations_program_id_fkey" FOREIGN KEY (program_id) REFERENCES core.vocational_programs(program_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE core.vocational_programs ADD CONSTRAINT "vocational_programs_field_id_fkey" FOREIGN KEY (field_id) REFERENCES core.vocational_fields(field_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.academic_periods ADD CONSTRAINT "academic_periods_closed_by_user_id_fkey" FOREIGN KEY (closed_by_user_id) REFERENCES users(user_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.academic_periods ADD CONSTRAINT "academic_periods_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessment_criteria ADD CONSTRAINT "assessment_criteria_learning_objective_id_fkey" FOREIGN KEY (learning_objective_id) REFERENCES learning_objectives(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessment_criteria ADD CONSTRAINT "assessment_criteria_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessment_results ADD CONSTRAINT "assessment_results_assessment_id_fkey" FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessment_results ADD CONSTRAINT "assessment_results_class_id_fkey" FOREIGN KEY (class_id) REFERENCES classes(class_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessment_results ADD CONSTRAINT "assessment_results_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessment_results ADD CONSTRAINT "assessment_results_student_id_fkey" FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessment_rubric_criteria ADD CONSTRAINT "assessment_rubric_criteria_assessment_id_fkey" FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessment_rubric_criteria ADD CONSTRAINT "assessment_rubric_criteria_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessment_rubric_criteria ADD CONSTRAINT "assessment_rubric_criteria_teacher_id_fkey" FOREIGN KEY (teacher_id) REFERENCES users(user_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessment_rubric_results ADD CONSTRAINT "assessment_rubric_results_assessment_id_fkey" FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessment_rubric_results ADD CONSTRAINT "assessment_rubric_results_criteria_id_fkey" FOREIGN KEY (criteria_id) REFERENCES assessment_rubric_criteria(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessment_rubric_results ADD CONSTRAINT "assessment_rubric_results_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessment_rubric_results ADD CONSTRAINT "assessment_rubric_results_student_id_fkey" FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessment_rubric_results ADD CONSTRAINT "assessment_rubric_results_teacher_id_fkey" FOREIGN KEY (teacher_id) REFERENCES users(user_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessments ADD CONSTRAINT "assessments_class_id_fkey" FOREIGN KEY (class_id) REFERENCES classes(class_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessments ADD CONSTRAINT "assessments_learning_objective_id_fkey" FOREIGN KEY (learning_objective_id) REFERENCES learning_objectives(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessments ADD CONSTRAINT "assessments_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessments ADD CONSTRAINT "assessments_subject_id_fkey" FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.assessments ADD CONSTRAINT "assessments_teacher_id_fkey" FOREIGN KEY (teacher_id) REFERENCES users(user_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.attendance ADD CONSTRAINT "attendance_recorded_by_user_id_fkey" FOREIGN KEY (recorded_by_user_id) REFERENCES users(user_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.attendance ADD CONSTRAINT "attendance_schedule_id_fkey" FOREIGN KEY (schedule_id) REFERENCES teaching_schedules(schedule_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.attendance ADD CONSTRAINT "attendance_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.attendance ADD CONSTRAINT "attendance_student_id_fkey" FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.bk_class_assignments ADD CONSTRAINT "bk_class_assignments_assigned_by_user_id_fkey" FOREIGN KEY (assigned_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.bk_class_assignments ADD CONSTRAINT "bk_class_assignments_bk_user_id_fkey" FOREIGN KEY (bk_user_id) REFERENCES users(user_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.bk_class_assignments ADD CONSTRAINT "bk_class_assignments_class_id_fkey" FOREIGN KEY (class_id) REFERENCES classes(class_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.bk_class_assignments ADD CONSTRAINT "bk_class_assignments_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.capaian_pembelajaran ADD CONSTRAINT "capaian_pembelajaran_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.capaian_pembelajaran ADD CONSTRAINT "capaian_pembelajaran_program_id_fkey" FOREIGN KEY (program_id) REFERENCES programs(program_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.capaian_pembelajaran ADD CONSTRAINT "capaian_pembelajaran_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.capaian_pembelajaran ADD CONSTRAINT "capaian_pembelajaran_subject_id_fkey" FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.class_enrollments ADD CONSTRAINT "class_enrollments_class_id_fkey" FOREIGN KEY (class_id) REFERENCES classes(class_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.class_enrollments ADD CONSTRAINT "class_enrollments_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.class_enrollments ADD CONSTRAINT "class_enrollments_student_id_fkey" FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.classes ADD CONSTRAINT "classes_program_id_fkey" FOREIGN KEY (program_id) REFERENCES programs(program_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.classes ADD CONSTRAINT "classes_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.coaching_case_events ADD CONSTRAINT "coaching_case_events_author_user_id_fkey" FOREIGN KEY (author_user_id) REFERENCES users(user_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.coaching_case_events ADD CONSTRAINT "coaching_case_events_case_id_fkey" FOREIGN KEY (case_id) REFERENCES coaching_cases(case_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.coaching_case_handlers ADD CONSTRAINT "coaching_case_handlers_assigned_by_user_id_fkey" FOREIGN KEY (assigned_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.coaching_case_handlers ADD CONSTRAINT "coaching_case_handlers_case_id_fkey" FOREIGN KEY (case_id) REFERENCES coaching_cases(case_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.coaching_case_handlers ADD CONSTRAINT "coaching_case_handlers_handler_user_id_fkey" FOREIGN KEY (handler_user_id) REFERENCES users(user_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.coaching_case_templates ADD CONSTRAINT "coaching_case_templates_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.coaching_cases ADD CONSTRAINT "coaching_cases_closed_by_user_id_fkey" FOREIGN KEY (closed_by_user_id) REFERENCES users(user_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.coaching_cases ADD CONSTRAINT "coaching_cases_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES users(user_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.coaching_cases ADD CONSTRAINT "coaching_cases_current_handler_user_id_fkey" FOREIGN KEY (current_handler_user_id) REFERENCES users(user_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.coaching_cases ADD CONSTRAINT "coaching_cases_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.coaching_cases ADD CONSTRAINT "coaching_cases_student_id_fkey" FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.duty_schedules ADD CONSTRAINT "duty_schedules_assigned_by_user_id_fkey" FOREIGN KEY (assigned_by_user_id) REFERENCES users(user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.duty_schedules ADD CONSTRAINT "duty_schedules_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.duty_schedules ADD CONSTRAINT "duty_schedules_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.evaluation_logs ADD CONSTRAINT "evaluation_logs_doc_id_fkey" FOREIGN KEY (doc_id) REFERENCES teacher_documents(doc_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.evaluation_logs ADD CONSTRAINT "evaluation_logs_job_id_fkey" FOREIGN KEY (job_id) REFERENCES generation_jobs(job_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.evaluation_logs ADD CONSTRAINT "evaluation_logs_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.evaluation_logs ADD CONSTRAINT "evaluation_logs_teacher_user_id_fkey" FOREIGN KEY (teacher_user_id) REFERENCES auth.users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_post_acknowledgements ADD CONSTRAINT "forum_post_acknowledgements_post_id_fkey" FOREIGN KEY (post_id) REFERENCES forum_posts(post_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_post_acknowledgements ADD CONSTRAINT "forum_post_acknowledgements_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_post_acknowledgements ADD CONSTRAINT "forum_post_acknowledgements_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_post_audience ADD CONSTRAINT "forum_post_audience_post_id_fkey" FOREIGN KEY (post_id) REFERENCES forum_posts(post_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_post_audience ADD CONSTRAINT "forum_post_audience_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_post_audience ADD CONSTRAINT "forum_post_audience_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_post_comments ADD CONSTRAINT "forum_post_comments_author_user_id_fkey" FOREIGN KEY (author_user_id) REFERENCES users(user_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_post_comments ADD CONSTRAINT "forum_post_comments_post_id_fkey" FOREIGN KEY (post_id) REFERENCES forum_posts(post_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_post_comments ADD CONSTRAINT "forum_post_comments_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_post_subjects ADD CONSTRAINT "forum_post_subjects_post_id_fkey" FOREIGN KEY (post_id) REFERENCES forum_posts(post_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_post_subjects ADD CONSTRAINT "forum_post_subjects_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_post_subjects ADD CONSTRAINT "forum_post_subjects_student_id_fkey" FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_posts ADD CONSTRAINT "forum_posts_author_user_id_fkey" FOREIGN KEY (author_user_id) REFERENCES users(user_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_posts ADD CONSTRAINT "forum_posts_category_id_fkey" FOREIGN KEY (category_id) REFERENCES communication_categories(category_id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_posts ADD CONSTRAINT "forum_posts_class_id_fkey" FOREIGN KEY (class_id) REFERENCES classes(class_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.forum_posts ADD CONSTRAINT "forum_posts_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.generation_jobs ADD CONSTRAINT "generation_jobs_doc_id_fkey" FOREIGN KEY (doc_id) REFERENCES teacher_documents(doc_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.generation_jobs ADD CONSTRAINT "generation_jobs_prompt_template_id_fkey" FOREIGN KEY (prompt_template_id) REFERENCES prompt_templates(template_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.generation_jobs ADD CONSTRAINT "generation_jobs_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.generation_jobs ADD CONSTRAINT "generation_jobs_teacher_user_id_fkey" FOREIGN KEY (teacher_user_id) REFERENCES auth.users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.grade_recap ADD CONSTRAINT "grade_recap_class_id_fkey" FOREIGN KEY (class_id) REFERENCES classes(class_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.grade_recap ADD CONSTRAINT "grade_recap_learning_objective_id_fkey" FOREIGN KEY (learning_objective_id) REFERENCES learning_objectives(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.grade_recap ADD CONSTRAINT "grade_recap_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.grade_recap ADD CONSTRAINT "grade_recap_student_id_fkey" FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.guru_wali_assignments ADD CONSTRAINT "guru_wali_assignments_assigned_by_user_id_fkey" FOREIGN KEY (assigned_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.guru_wali_assignments ADD CONSTRAINT "guru_wali_assignments_guru_user_id_fkey" FOREIGN KEY (guru_user_id) REFERENCES users(user_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.guru_wali_assignments ADD CONSTRAINT "guru_wali_assignments_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.guru_wali_assignments ADD CONSTRAINT "guru_wali_assignments_student_id_fkey" FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.late_arrivals ADD CONSTRAINT "late_arrivals_recorded_by_fkey" FOREIGN KEY (recorded_by) REFERENCES users(user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.late_arrivals ADD CONSTRAINT "late_arrivals_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.late_arrivals ADD CONSTRAINT "late_arrivals_student_id_fkey" FOREIGN KEY (student_id) REFERENCES students(student_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_context_snapshots ADD CONSTRAINT "ld_context_snapshots_class_id_fkey" FOREIGN KEY (class_id) REFERENCES classes(class_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_context_snapshots ADD CONSTRAINT "ld_context_snapshots_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_context_snapshots ADD CONSTRAINT "ld_context_snapshots_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_context_snapshots ADD CONSTRAINT "ld_context_snapshots_teaching_assignment_id_fkey" FOREIGN KEY (teaching_assignment_id) REFERENCES teaching_assignments(assignment_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_document_nodes ADD CONSTRAINT "ld_document_nodes_document_id_fkey" FOREIGN KEY (document_id) REFERENCES ld_documents(document_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_document_nodes ADD CONSTRAINT "ld_document_nodes_last_edited_by_fkey" FOREIGN KEY (last_edited_by) REFERENCES users(user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_document_nodes ADD CONSTRAINT "ld_document_nodes_parent_node_id_fkey" FOREIGN KEY (parent_node_id) REFERENCES ld_document_nodes(node_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_document_nodes ADD CONSTRAINT "ld_document_nodes_prompt_template_id_fkey" FOREIGN KEY (prompt_template_id) REFERENCES ld_prompt_templates(template_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_document_tp_links ADD CONSTRAINT "ld_document_tp_links_document_id_fkey" FOREIGN KEY (document_id) REFERENCES ld_documents(document_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_document_tp_links ADD CONSTRAINT "ld_document_tp_links_node_id_fkey" FOREIGN KEY (node_id) REFERENCES ld_document_nodes(node_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_document_tp_links ADD CONSTRAINT "ld_document_tp_links_tp_id_fkey" FOREIGN KEY (tp_id) REFERENCES tujuan_pembelajaran(tp_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_document_versions ADD CONSTRAINT "ld_document_versions_document_id_fkey" FOREIGN KEY (document_id) REFERENCES ld_documents(document_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_document_versions ADD CONSTRAINT "ld_document_versions_published_by_fkey" FOREIGN KEY (published_by) REFERENCES users(user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_documents ADD CONSTRAINT "ld_documents_class_id_fkey" FOREIGN KEY (class_id) REFERENCES classes(class_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_documents ADD CONSTRAINT "ld_documents_context_snapshot_id_fkey" FOREIGN KEY (context_snapshot_id) REFERENCES ld_context_snapshots(snapshot_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_documents ADD CONSTRAINT "ld_documents_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_documents ADD CONSTRAINT "ld_documents_program_id_fkey" FOREIGN KEY (program_id) REFERENCES programs(program_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_documents ADD CONSTRAINT "ld_documents_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_documents ADD CONSTRAINT "ld_documents_subject_id_fkey" FOREIGN KEY (subject_id) REFERENCES subjects(subject_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_documents ADD CONSTRAINT "ld_documents_teaching_assignment_id_fkey" FOREIGN KEY (teaching_assignment_id) REFERENCES teaching_assignments(assignment_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_program_knowledge_school ADD CONSTRAINT "ld_program_knowledge_school_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_program_knowledge_school ADD CONSTRAINT "ld_program_knowledge_school_program_id_fkey" FOREIGN KEY (program_id) REFERENCES programs(program_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_program_knowledge_school ADD CONSTRAINT "ld_program_knowledge_school_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_teacher_knowledge ADD CONSTRAINT "ld_teacher_knowledge_program_id_fkey" FOREIGN KEY (program_id) REFERENCES programs(program_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_teacher_knowledge ADD CONSTRAINT "ld_teacher_knowledge_subject_id_fkey" FOREIGN KEY (subject_id) REFERENCES subjects(subject_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ld_teacher_knowledge ADD CONSTRAINT "ld_teacher_knowledge_teacher_id_fkey" FOREIGN KEY (teacher_id) REFERENCES users(user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.learning_objectives ADD CONSTRAINT "learning_objectives_class_id_fkey" FOREIGN KEY (class_id) REFERENCES classes(class_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.learning_objectives ADD CONSTRAINT "learning_objectives_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.learning_objectives ADD CONSTRAINT "learning_objectives_subject_id_fkey" FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.learning_objectives ADD CONSTRAINT "learning_objectives_teacher_id_fkey" FOREIGN KEY (teacher_id) REFERENCES users(user_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.login_devices ADD CONSTRAINT "login_devices_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.login_devices ADD CONSTRAINT "login_devices_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.notifications ADD CONSTRAINT "notifications_forum_comment_id_fkey" FOREIGN KEY (forum_comment_id) REFERENCES forum_post_comments(comment_id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.notifications ADD CONSTRAINT "notifications_forum_post_id_fkey" FOREIGN KEY (forum_post_id) REFERENCES forum_posts(post_id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.notifications ADD CONSTRAINT "notifications_late_arrival_id_fkey" FOREIGN KEY (late_arrival_id) REFERENCES late_arrivals(late_id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.notifications ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY (recipient_user_id) REFERENCES users(user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.notifications ADD CONSTRAINT "notifications_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.observations ADD CONSTRAINT "observations_author_user_id_fkey" FOREIGN KEY (author_user_id) REFERENCES users(user_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.observations ADD CONSTRAINT "observations_class_id_fkey" FOREIGN KEY (class_id) REFERENCES classes(class_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.observations ADD CONSTRAINT "observations_schedule_id_fkey" FOREIGN KEY (schedule_id) REFERENCES teaching_schedules(schedule_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.observations ADD CONSTRAINT "observations_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.observations ADD CONSTRAINT "observations_student_id_fkey" FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.observations ADD CONSTRAINT "observations_voided_by_fkey" FOREIGN KEY (voided_by) REFERENCES users(user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.pending_auth_deletions ADD CONSTRAINT "pending_auth_deletions_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.pkl_attendance ADD CONSTRAINT "pkl_attendance_placement_id_fkey" FOREIGN KEY (placement_id) REFERENCES pkl_placements(placement_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.pkl_attendance ADD CONSTRAINT "pkl_attendance_recorded_by_user_id_fkey" FOREIGN KEY (recorded_by_user_id) REFERENCES users(user_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.pkl_attendance ADD CONSTRAINT "pkl_attendance_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.pkl_attendance ADD CONSTRAINT "pkl_attendance_student_id_fkey" FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.pkl_placements ADD CONSTRAINT "pkl_placements_dudi_user_id_fkey" FOREIGN KEY (dudi_user_id) REFERENCES users(user_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.pkl_placements ADD CONSTRAINT "pkl_placements_guru_pembimbing_user_id_fkey" FOREIGN KEY (guru_pembimbing_user_id) REFERENCES users(user_id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.pkl_placements ADD CONSTRAINT "pkl_placements_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.pkl_placements ADD CONSTRAINT "pkl_placements_student_id_fkey" FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.programs ADD CONSTRAINT "programs_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.schedule_reapply_jobs ADD CONSTRAINT "schedule_reapply_jobs_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.schedule_reapply_jobs ADD CONSTRAINT "schedule_reapply_jobs_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.schedule_reapply_targets ADD CONSTRAINT "schedule_reapply_targets_job_id_fkey" FOREIGN KEY (job_id) REFERENCES schedule_reapply_jobs(job_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.schedule_templates ADD CONSTRAINT "schedule_templates_class_id_fkey" FOREIGN KEY (class_id) REFERENCES classes(class_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.schedule_templates ADD CONSTRAINT "schedule_templates_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.schedule_templates ADD CONSTRAINT "schedule_templates_subject_id_fkey" FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.schedule_templates ADD CONSTRAINT "schedule_templates_teacher_id_fkey" FOREIGN KEY (teacher_id) REFERENCES users(user_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.schedule_time_slots ADD CONSTRAINT "schedule_time_slots_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.school_config ADD CONSTRAINT "school_config_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_exits ADD CONSTRAINT "student_exits_recorded_by_fkey" FOREIGN KEY (recorded_by) REFERENCES users(user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_exits ADD CONSTRAINT "student_exits_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_exits ADD CONSTRAINT "student_exits_student_id_fkey" FOREIGN KEY (student_id) REFERENCES students(student_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_grades ADD CONSTRAINT "student_grades_assessment_id_fkey" FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_grades ADD CONSTRAINT "student_grades_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_grades ADD CONSTRAINT "student_grades_student_id_fkey" FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_grades ADD CONSTRAINT "student_grades_teacher_id_fkey" FOREIGN KEY (teacher_id) REFERENCES users(user_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_groups ADD CONSTRAINT "student_groups_class_id_fkey" FOREIGN KEY (class_id) REFERENCES classes(class_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_groups ADD CONSTRAINT "student_groups_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_groups ADD CONSTRAINT "student_groups_student_id_fkey" FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_parents ADD CONSTRAINT "student_parents_parent_user_id_fkey" FOREIGN KEY (parent_user_id) REFERENCES users(user_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_parents ADD CONSTRAINT "student_parents_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_parents ADD CONSTRAINT "student_parents_student_id_fkey" FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_updates ADD CONSTRAINT "student_updates_author_user_id_fkey" FOREIGN KEY (author_user_id) REFERENCES users(user_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.student_updates ADD CONSTRAINT "student_updates_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.students ADD CONSTRAINT "students_program_id_fkey" FOREIGN KEY (program_id) REFERENCES programs(program_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.students ADD CONSTRAINT "students_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.students ADD CONSTRAINT "students_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.subject_code_aliases ADD CONSTRAINT "subject_code_aliases_core_subject_id_fkey" FOREIGN KEY (core_subject_id) REFERENCES core.subjects(subject_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.subject_code_aliases ADD CONSTRAINT "subject_code_aliases_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.subject_cp_mapping ADD CONSTRAINT "subject_cp_mapping_core_subject_id_fkey" FOREIGN KEY (core_subject_id) REFERENCES core.subjects(subject_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.subject_cp_mapping ADD CONSTRAINT "subject_cp_mapping_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.subject_cp_mapping ADD CONSTRAINT "subject_cp_mapping_program_id_fkey" FOREIGN KEY (program_id) REFERENCES core.vocational_programs(program_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.subject_cp_mapping ADD CONSTRAINT "subject_cp_mapping_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.subject_cp_mapping ADD CONSTRAINT "subject_cp_mapping_subject_id_fkey" FOREIGN KEY (subject_id) REFERENCES subjects(subject_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.subjects ADD CONSTRAINT "subjects_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.substitute_schedules ADD CONSTRAINT "substitute_schedules_granted_by_user_id_fkey" FOREIGN KEY (granted_by_user_id) REFERENCES users(user_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.substitute_schedules ADD CONSTRAINT "substitute_schedules_schedule_id_fkey" FOREIGN KEY (schedule_id) REFERENCES teaching_schedules(schedule_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.substitute_schedules ADD CONSTRAINT "substitute_schedules_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.substitute_schedules ADD CONSTRAINT "substitute_schedules_substitute_user_id_fkey" FOREIGN KEY (substitute_user_id) REFERENCES users(user_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.sync_idempotency ADD CONSTRAINT "sync_idempotency_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_attendance_log ADD CONSTRAINT "teacher_attendance_log_schedule_id_fkey" FOREIGN KEY (schedule_id) REFERENCES teaching_schedules(schedule_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_attendance_log ADD CONSTRAINT "teacher_attendance_log_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_attendance_log ADD CONSTRAINT "teacher_attendance_log_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_document_approvals ADD CONSTRAINT "teacher_document_approvals_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES auth.users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_document_approvals ADD CONSTRAINT "teacher_document_approvals_doc_id_fkey" FOREIGN KEY (doc_id) REFERENCES teacher_documents(doc_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_document_approvals ADD CONSTRAINT "teacher_document_approvals_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_document_classes ADD CONSTRAINT "teacher_document_classes_class_id_fkey" FOREIGN KEY (class_id) REFERENCES classes(class_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_document_classes ADD CONSTRAINT "teacher_document_classes_doc_id_fkey" FOREIGN KEY (doc_id) REFERENCES teacher_documents(doc_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_document_classes ADD CONSTRAINT "teacher_document_classes_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_documents ADD CONSTRAINT "teacher_documents_core_subject_id_fkey" FOREIGN KEY (core_subject_id) REFERENCES core.subjects(subject_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_documents ADD CONSTRAINT "teacher_documents_parent_doc_id_fkey" FOREIGN KEY (parent_doc_id) REFERENCES teacher_documents(doc_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_documents ADD CONSTRAINT "teacher_documents_phase_id_fkey" FOREIGN KEY (phase_id) REFERENCES core.phases(phase_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_documents ADD CONSTRAINT "teacher_documents_program_id_fkey" FOREIGN KEY (program_id) REFERENCES core.vocational_programs(program_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_documents ADD CONSTRAINT "teacher_documents_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_documents ADD CONSTRAINT "teacher_documents_source_doc_id_fkey" FOREIGN KEY (source_doc_id) REFERENCES teacher_documents(doc_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_documents ADD CONSTRAINT "teacher_documents_teacher_user_id_fkey" FOREIGN KEY (teacher_user_id) REFERENCES auth.users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_journals ADD CONSTRAINT "teacher_journals_owner_user_id_fkey" FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_journals ADD CONSTRAINT "teacher_journals_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_piket_assignments ADD CONSTRAINT "teacher_piket_assignments_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_profiles ADD CONSTRAINT "teacher_profiles_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_profiles ADD CONSTRAINT "teacher_profiles_teacher_user_id_fkey" FOREIGN KEY (teacher_user_id) REFERENCES auth.users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teaching_assignments ADD CONSTRAINT "teaching_assignments_class_id_fkey" FOREIGN KEY (class_id) REFERENCES classes(class_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teaching_assignments ADD CONSTRAINT "teaching_assignments_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teaching_assignments ADD CONSTRAINT "teaching_assignments_subject_id_fkey" FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teaching_assignments ADD CONSTRAINT "teaching_assignments_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teaching_contexts ADD CONSTRAINT "teaching_contexts_class_id_fkey" FOREIGN KEY (class_id) REFERENCES classes(class_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teaching_contexts ADD CONSTRAINT "teaching_contexts_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teaching_contexts ADD CONSTRAINT "teaching_contexts_subject_id_fkey" FOREIGN KEY (subject_id) REFERENCES subjects(subject_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teaching_contexts ADD CONSTRAINT "teaching_contexts_teacher_user_id_fkey" FOREIGN KEY (teacher_user_id) REFERENCES auth.users(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teaching_cp_elements ADD CONSTRAINT "teaching_cp_elements_cp_id_fkey" FOREIGN KEY (cp_id) REFERENCES teaching_cp(cp_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teaching_schedules ADD CONSTRAINT "teaching_schedules_assignment_id_fkey" FOREIGN KEY (assignment_id) REFERENCES teaching_assignments(assignment_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teaching_schedules ADD CONSTRAINT "teaching_schedules_class_id_fkey" FOREIGN KEY (class_id) REFERENCES classes(class_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teaching_schedules ADD CONSTRAINT "teaching_schedules_scheduled_teacher_id_fkey" FOREIGN KEY (scheduled_teacher_id) REFERENCES users(user_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teaching_schedules ADD CONSTRAINT "teaching_schedules_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teaching_schedules ADD CONSTRAINT "teaching_schedules_subject_id_fkey" FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.tp_taught_status ADD CONSTRAINT "tp_taught_status_class_id_fkey" FOREIGN KEY (class_id) REFERENCES classes(class_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.tp_taught_status ADD CONSTRAINT "tp_taught_status_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.tp_taught_status ADD CONSTRAINT "tp_taught_status_teacher_id_fkey" FOREIGN KEY (teacher_id) REFERENCES users(user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.tujuan_pembelajaran ADD CONSTRAINT "tujuan_pembelajaran_cp_id_fkey" FOREIGN KEY (cp_id) REFERENCES capaian_pembelajaran(cp_id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.tujuan_pembelajaran ADD CONSTRAINT "tujuan_pembelajaran_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.tujuan_pembelajaran ADD CONSTRAINT "tujuan_pembelajaran_program_id_fkey" FOREIGN KEY (program_id) REFERENCES programs(program_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.tujuan_pembelajaran ADD CONSTRAINT "tujuan_pembelajaran_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.tujuan_pembelajaran ADD CONSTRAINT "tujuan_pembelajaran_subject_id_fkey" FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.users ADD CONSTRAINT "fk_users_wali_kelas_class" FOREIGN KEY (wali_kelas_class_id) REFERENCES classes(class_id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.users ADD CONSTRAINT "users_kaprodi_program_id_fkey" FOREIGN KEY (kaprodi_program_id) REFERENCES programs(program_id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.users ADD CONSTRAINT "users_program_id_fkey" FOREIGN KEY (program_id) REFERENCES programs(program_id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.users ADD CONSTRAINT "users_school_id_fkey" FOREIGN KEY (school_id) REFERENCES schools(school_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Indeks
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_ac_lo_id ON public.assessment_criteria USING btree (learning_objective_id);
CREATE INDEX IF NOT EXISTS idx_ac_school_id ON public.assessment_criteria USING btree (school_id);
CREATE INDEX IF NOT EXISTS idx_academic_periods_status ON public.academic_periods USING btree (status);
CREATE INDEX IF NOT EXISTS idx_assessment_results_assessment ON public.assessment_results USING btree (assessment_id);
CREATE INDEX IF NOT EXISTS idx_assessments_class_subject_year ON public.assessments USING btree (class_id, subject_id, academic_year, semester);
CREATE INDEX IF NOT EXISTS idx_assessments_school_class ON public.assessments USING btree (school_id, class_id, subject_id, academic_year, semester);
CREATE INDEX IF NOT EXISTS idx_assessments_school_teacher ON public.assessments USING btree (school_id, teacher_id);
CREATE INDEX IF NOT EXISTS idx_assignments_class ON public.teaching_assignments USING btree (class_id) WHERE (is_active = true);
CREATE INDEX IF NOT EXISTS idx_assignments_user ON public.teaching_assignments USING btree (user_id) WHERE (is_active = true);
CREATE INDEX IF NOT EXISTS idx_att_class_date_status ON public.attendance USING btree (schedule_id, status) INCLUDE (student_id, is_void) WHERE (is_void = false);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON public.attendance USING btree (schedule_id) INCLUDE (student_id, status);
CREATE INDEX IF NOT EXISTS idx_attendance_schedule ON public.attendance USING btree (schedule_id);
CREATE INDEX IF NOT EXISTS idx_attendance_school ON public.attendance USING btree (school_id);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON public.attendance USING btree (student_id, schedule_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_school_table ON public.audit_log USING btree (school_id, table_name, deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_bk_class_bk ON public.bk_class_assignments USING btree (school_id, bk_user_id, academic_year);
CREATE INDEX IF NOT EXISTS idx_bk_class_class ON public.bk_class_assignments USING btree (school_id, class_id, academic_year);
CREATE INDEX IF NOT EXISTS idx_cc_created_by ON public.coaching_cases USING btree (created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_cc_handler ON public.coaching_cases USING btree (current_handler_user_id, status) WHERE (status <> 'CLOSED'::case_status);
CREATE INDEX IF NOT EXISTS idx_cc_school ON public.coaching_cases USING btree (school_id);
CREATE INDEX IF NOT EXISTS idx_cc_shared_p ON public.coaching_cases USING btree (student_id) WHERE (is_shared_to_parent = true);
CREATE INDEX IF NOT EXISTS idx_cc_shared_s ON public.coaching_cases USING btree (student_id) WHERE (is_shared_to_student = true);
CREATE INDEX IF NOT EXISTS idx_cc_student ON public.coaching_cases USING btree (student_id, status);
CREATE INDEX IF NOT EXISTS idx_cce_author ON public.coaching_case_events USING btree (author_user_id);
CREATE INDEX IF NOT EXISTS idx_cce_case ON public.coaching_case_events USING btree (case_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cce_visible ON public.coaching_case_events USING btree (case_id) WHERE (is_visible_to_student = true);
CREATE INDEX IF NOT EXISTS idx_cch_case_history ON public.coaching_case_handlers USING btree (case_id, assigned_at DESC);
CREATE INDEX IF NOT EXISTS idx_cch_handler_user ON public.coaching_case_handlers USING btree (handler_user_id);
CREATE INDEX IF NOT EXISTS idx_cct_school ON public.coaching_case_templates USING btree (school_id) WHERE (is_active = true);
CREATE INDEX IF NOT EXISTS idx_classes_school ON public.classes USING btree (school_id);
CREATE INDEX IF NOT EXISTS idx_comm_cat_order ON public.communication_categories USING btree (display_order, category_code);
CREATE INDEX IF NOT EXISTS idx_cp_fase ON public.capaian_pembelajaran USING btree (fase);
CREATE INDEX IF NOT EXISTS idx_cp_school_subject ON public.capaian_pembelajaran USING btree (school_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_class ON public.class_enrollments USING btree (class_id, academic_year, semester);
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON public.class_enrollments USING btree (student_id, academic_year, semester);
CREATE INDEX IF NOT EXISTS idx_exits_school_date ON public.student_exits USING btree (school_id, exit_date);
CREATE INDEX IF NOT EXISTS idx_exits_student ON public.student_exits USING btree (student_id);
CREATE INDEX IF NOT EXISTS idx_forum_ack_post ON public.forum_post_acknowledgements USING btree (post_id);
CREATE INDEX IF NOT EXISTS idx_forum_ack_user ON public.forum_post_acknowledgements USING btree (school_id, user_id);
CREATE INDEX IF NOT EXISTS idx_forum_aud_post ON public.forum_post_audience USING btree (post_id);
CREATE INDEX IF NOT EXISTS idx_forum_aud_user ON public.forum_post_audience USING btree (school_id, user_id);
CREATE INDEX IF NOT EXISTS idx_forum_comments_author ON public.forum_post_comments USING btree (school_id, author_user_id);
CREATE INDEX IF NOT EXISTS idx_forum_comments_post ON public.forum_post_comments USING btree (post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_forum_posts_author ON public.forum_posts USING btree (school_id, author_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_posts_class ON public.forum_posts USING btree (school_id, class_id, academic_year, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_posts_pinned ON public.forum_posts USING btree (school_id, class_id, academic_year, is_pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_posts_scope ON public.forum_posts USING btree (school_id, scope_type) WHERE (scope_type = 'SEKOLAH'::text);
CREATE INDEX IF NOT EXISTS idx_forum_subj_student ON public.forum_post_subjects USING btree (school_id, student_id);
CREATE INDEX IF NOT EXISTS idx_guru_wali_guru ON public.guru_wali_assignments USING btree (school_id, guru_user_id, academic_year);
CREATE INDEX IF NOT EXISTS idx_guru_wali_student ON public.guru_wali_assignments USING btree (school_id, student_id, academic_year);
CREATE INDEX IF NOT EXISTS idx_idempotency_created ON public.sync_idempotency USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_journals_owner ON public.teacher_journals USING btree (owner_user_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_journals_owner_date ON public.teacher_journals USING btree (owner_user_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_ld_docs_assignment ON public.ld_documents USING btree (teaching_assignment_id);
CREATE INDEX IF NOT EXISTS idx_ld_docs_created_by ON public.ld_documents USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_ld_docs_school ON public.ld_documents USING btree (school_id);
CREATE INDEX IF NOT EXISTS idx_ld_docs_type ON public.ld_documents USING btree (document_type);
CREATE INDEX IF NOT EXISTS idx_ld_nodes_content_fts ON public.ld_document_nodes USING gin (to_tsvector('indonesian'::regconfig, COALESCE(content_text, ''::text)));
CREATE INDEX IF NOT EXISTS idx_ld_nodes_document ON public.ld_document_nodes USING btree (document_id);
CREATE INDEX IF NOT EXISTS idx_ld_nodes_parent ON public.ld_document_nodes USING btree (parent_node_id);
CREATE INDEX IF NOT EXISTS idx_ld_nodes_type ON public.ld_document_nodes USING btree (node_type);
CREATE INDEX IF NOT EXISTS idx_ld_snapshots_assignment ON public.ld_context_snapshots USING btree (teaching_assignment_id);
CREATE INDEX IF NOT EXISTS idx_ld_snapshots_class ON public.ld_context_snapshots USING btree (class_id);
CREATE INDEX IF NOT EXISTS idx_ld_tp_links_tp ON public.ld_document_tp_links USING btree (tp_id);
CREATE INDEX IF NOT EXISTS idx_lo_school_class_subject_year ON public.learning_objectives USING btree (school_id, class_id, subject_id, academic_year, semester);
CREATE INDEX IF NOT EXISTS idx_login_devices_user ON public.login_devices USING btree (user_id, last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_national_knowledge_code ON public.ld_program_knowledge_national USING btree (program_code);
CREATE INDEX IF NOT EXISTS idx_notif_late_arrival ON public.notifications USING btree (late_arrival_id) WHERE (late_arrival_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_notif_recipient ON public.notifications USING btree (recipient_user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_school ON public.notifications USING btree (school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_obs_student_visible_date ON public.observations USING btree (student_id, observed_at DESC) WHERE ((visibility = 'STUDENT_VISIBLE'::visibility_level) AND (sentiment = 'POSITIF'::observation_sentiment));
CREATE INDEX IF NOT EXISTS idx_observations_author ON public.observations USING btree (author_user_id);
CREATE INDEX IF NOT EXISTS idx_observations_school ON public.observations USING btree (school_id);
CREATE INDEX IF NOT EXISTS idx_observations_student ON public.observations USING btree (student_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_observations_student_visible ON public.observations USING btree (student_id) WHERE ((visibility = 'STUDENT_VISIBLE'::visibility_level) AND (sentiment = 'POSITIF'::observation_sentiment));
CREATE INDEX IF NOT EXISTS idx_pending_auth_deletions_purge ON public.pending_auth_deletions USING btree (school_id, purge_student_id, processed_at);
CREATE INDEX IF NOT EXISTS idx_piket_school_day ON public.teacher_piket_assignments USING btree (school_id, day_of_week) WHERE (is_active = true);
CREATE INDEX IF NOT EXISTS idx_pkl_active_student ON public.pkl_placements USING btree (student_id, dudi_user_id) WHERE (is_active = true);
CREATE INDEX IF NOT EXISTS idx_pkl_attendance_date ON public.pkl_attendance USING btree (attendance_date);
CREATE INDEX IF NOT EXISTS idx_pkl_attendance_placement ON public.pkl_attendance USING btree (placement_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_pkl_attendance_student ON public.pkl_attendance USING btree (student_id, attendance_date DESC);
CREATE INDEX IF NOT EXISTS idx_pkl_placements_dudi ON public.pkl_placements USING btree (dudi_user_id) WHERE (is_active = true);
CREATE INDEX IF NOT EXISTS idx_pkl_placements_guru_pembimbing ON public.pkl_placements USING btree (guru_pembimbing_user_id) WHERE (guru_pembimbing_user_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_pkl_placements_student ON public.pkl_placements USING btree (student_id) WHERE (is_active = true);
CREATE INDEX IF NOT EXISTS idx_rubric_criteria_assessment ON public.assessment_rubric_criteria USING btree (assessment_id);
CREATE INDEX IF NOT EXISTS idx_rubric_results_assessment_student ON public.assessment_rubric_results USING btree (assessment_id, student_id);
CREATE INDEX IF NOT EXISTS idx_schedule_templates_class ON public.schedule_templates USING btree (class_id, academic_year, semester);
CREATE INDEX IF NOT EXISTS idx_schedule_templates_teacher ON public.schedule_templates USING btree (teacher_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_schedules_class_date ON public.teaching_schedules USING btree (class_id, session_date);
CREATE INDEX IF NOT EXISTS idx_schedules_date ON public.teaching_schedules USING btree (session_date);
CREATE INDEX IF NOT EXISTS idx_schedules_school_date ON public.teaching_schedules USING btree (school_id, session_date);
CREATE INDEX IF NOT EXISTS idx_schedules_teacher_date ON public.teaching_schedules USING btree (scheduled_teacher_id, session_date);
CREATE INDEX IF NOT EXISTS idx_schedules_teacher_upcoming ON public.teaching_schedules USING btree (scheduled_teacher_id, session_date) WHERE (teacher_indicator = 'PENDING_EVALUATION'::teacher_attendance_indicator);
CREATE INDEX IF NOT EXISTS idx_student_grades_assessment ON public.student_grades USING btree (assessment_id);
CREATE INDEX IF NOT EXISTS idx_student_grades_school_student ON public.student_grades USING btree (school_id, student_id);
CREATE INDEX IF NOT EXISTS idx_student_parents_parent ON public.student_parents USING btree (parent_user_id);
CREATE INDEX IF NOT EXISTS idx_student_parents_student ON public.student_parents USING btree (student_id);
CREATE INDEX IF NOT EXISTS idx_student_updates_case ON public.student_updates USING btree (case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_students_graduated_year ON public.students USING btree (school_id, graduated_academic_year) WHERE ((student_status = 'LULUS'::student_status) AND (anonymized_at IS NULL));
CREATE INDEX IF NOT EXISTS idx_students_school ON public.students USING btree (school_id);
CREATE INDEX IF NOT EXISTS idx_subject_name_mapping_core_subject ON core.subject_name_mapping USING btree (core_subject_id);
CREATE INDEX IF NOT EXISTS idx_subject_name_mapping_kode ON core.subject_name_mapping USING btree (kode_pattern);
CREATE INDEX IF NOT EXISTS idx_subject_name_mapping_program_grade ON core.subject_name_mapping USING btree (program_hint, grade_level);
CREATE INDEX IF NOT EXISTS idx_substitute_sched ON public.substitute_schedules USING btree (schedule_id);
CREATE INDEX IF NOT EXISTS idx_substitute_user ON public.substitute_schedules USING btree (substitute_user_id);
CREATE INDEX IF NOT EXISTS idx_teacher_att_log_schedule ON public.teacher_attendance_log USING btree (schedule_id);
CREATE INDEX IF NOT EXISTS idx_teacher_att_log_user ON public.teacher_attendance_log USING btree (user_id, activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_teaching_schedules_school ON public.teaching_schedules USING btree (school_id);
CREATE INDEX IF NOT EXISTS idx_time_slots_day ON public.schedule_time_slots USING btree (academic_year, semester, day_of_week);
CREATE INDEX IF NOT EXISTS idx_tp_cp ON public.tujuan_pembelajaran USING btree (cp_id);
CREATE INDEX IF NOT EXISTS idx_tp_fase_semester ON public.tujuan_pembelajaran USING btree (fase, semester);
CREATE INDEX IF NOT EXISTS idx_tp_school_subject ON public.tujuan_pembelajaran USING btree (school_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON public.users USING btree (school_id, deleted_at) WHERE (deleted_at IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_users_school ON public.users USING btree (school_id);
CREATE INDEX IF NOT EXISTS ix_reapply_targets_pending ON public.schedule_reapply_targets USING btree (job_id) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS ix_reapply_targets_school ON public.schedule_reapply_targets USING btree (school_id, job_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cch_active_handler ON public.coaching_case_handlers USING btree (case_id) WHERE (handover_at IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS students_school_nis_key ON public.students USING btree (school_id, nis);
CREATE UNIQUE INDEX IF NOT EXISTS uq_forum_posts_idempotency ON public.forum_posts USING btree (school_id, author_user_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS uq_school_kepsek_active ON public.users USING btree (school_id) WHERE (((role_type = 'KEPSEK'::role_type) OR (is_kepsek = true)) AND (is_active = true) AND (deleted_at IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS uq_school_waka_humas_active ON public.users USING btree (school_id) WHERE (((role_type = 'WAKA_HUMAS'::role_type) OR (is_waka_humas = true)) AND (is_active = true) AND (deleted_at IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS uq_school_waka_kesiswaan_active ON public.users USING btree (school_id) WHERE (((role_type = 'WAKA_KESISWAAN'::role_type) OR (is_waka_kesiswaan = true)) AND (is_active = true) AND (deleted_at IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS uq_school_waka_kurikulum_active ON public.users USING btree (school_id) WHERE (((role_type = 'WAKA_KURIKULUM'::role_type) OR (is_waka_kurikulum = true)) AND (is_active = true) AND (deleted_at IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS ux_reapply_one_active_job ON public.schedule_reapply_jobs USING btree (school_id, academic_year, semester) WHERE (status = ANY (ARRAY['PENDING'::text, 'DELETING'::text, 'DELETED'::text, 'GENERATING'::text]));

-- ============================================================
-- Fungsi
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_admin_delete_coaching_case(p_case_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Validasi: hanya ADMINISTRATIVE
    IF fn_current_user_role() != 'ADMINISTRATIVE'::role_type THEN
        RAISE EXCEPTION 'permission_denied: hanya ADMINISTRATIVE yang dapat menghapus kasus'
            USING ERRCODE = 'P0001';
    END IF;

    -- Validasi: kasus ada di sekolah user
    IF NOT EXISTS (
        SELECT 1 FROM coaching_cases
        WHERE case_id = p_case_id AND school_id = fn_current_school_id()
    ) THEN
        RAISE EXCEPTION 'not_found: kasus tidak ditemukan di sekolah ini'
            USING ERRCODE = 'P0004';
    END IF;

    -- Validasi: alasan wajib diisi
    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RAISE EXCEPTION 'validation_error: alasan penghapusan wajib diisi'
            USING ERRCODE = 'P0001';
    END IF;

    -- Simpan alasan agar bisa diambil oleh fn_coaching_case_audit_delete trigger
    PERFORM set_config('app.coaching_delete_reason', p_reason, true);

    DELETE FROM coaching_cases WHERE case_id = p_case_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_admin_panel_dudi()
 RETURNS TABLE(user_id uuid, full_name text, dudi_org_name text, program_id uuid, must_change_password boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Guard: hanya ADMINISTRATIVE aktif di sekolah yang sama
    IF (SELECT role_type FROM public.users
        WHERE auth_user_id = auth.uid()
          AND school_id    = fn_current_school_id()
          AND role_type    = 'ADMINISTRATIVE'
          AND deleted_at   IS NULL
        LIMIT 1) IS NULL THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT u.user_id,
           u.full_name::text,
           u.dudi_org_name::text,
           u.program_id,
           u.must_change_password
    FROM public.users u
    WHERE u.school_id  = fn_current_school_id()
      AND u.role_type  = 'DUDI'
      AND u.deleted_at IS NULL
    ORDER BY u.dudi_org_name;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_admin_panel_staff(p_role_type text)
 RETURNS TABLE(user_id uuid, full_name text, login_identifier text, must_change_password boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Validasi p_role_type (allowlist eksplisit)
    IF p_role_type NOT IN ('STAKEHOLDER', 'TU') THEN
        RAISE EXCEPTION 'invalid role_type' USING ERRCODE = '22023';
    END IF;

    -- Guard: hanya ADMINISTRATIVE aktif di sekolah yang sama
    IF (SELECT role_type FROM public.users
        WHERE auth_user_id = auth.uid()
          AND school_id    = fn_current_school_id()
          AND role_type    = 'ADMINISTRATIVE'
          AND deleted_at   IS NULL
        LIMIT 1) IS NULL THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT u.user_id,
           u.full_name::text,
           u.login_identifier::text,
           u.must_change_password
    FROM public.users u
    WHERE u.school_id  = fn_current_school_id()
      AND u.role_type  = p_role_type::role_type
      AND u.deleted_at IS NULL
    ORDER BY u.full_name;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_apply_schedule_templates(p_academic_year text, p_semester semester, p_school_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_kbm_id    uuid;
    v_start     date;
    v_end       date;
    v_templates integer;
    v_assigns   integer;
    v_schedules integer;

    v_label     text;
    v_subj_id   uuid;
BEGIN
    SELECT count(*) INTO v_templates
    FROM schedule_templates
    WHERE academic_year = p_academic_year AND semester = p_semester
      AND school_id = p_school_id;

    IF v_templates = 0 THEN
        RETURN jsonb_build_object('templates_found', 0, 'assignments_upserted', 0, 'schedules_generated', 0);
    END IF;

    SELECT start_date, end_date INTO v_start, v_end
    FROM academic_periods
    WHERE academic_year = p_academic_year AND semester = p_semester
      AND school_id = p_school_id;

    IF v_start IS NULL THEN
        RAISE EXCEPTION 'Periode akademik % semester % belum terdaftar', p_academic_year, p_semester;
    END IF;

    SELECT subject_id INTO v_kbm_id
    FROM subjects WHERE code = 'KBM' AND school_id = p_school_id;
    IF v_kbm_id IS NULL THEN
        INSERT INTO subjects (code, name, is_active, school_id)
        VALUES ('KBM', 'Kegiatan Belajar Mengajar', true, p_school_id)
        RETURNING subject_id INTO v_kbm_id;
    END IF;

    FOR v_label IN
        SELECT DISTINCT subject_label
        FROM schedule_templates
        WHERE academic_year = p_academic_year AND semester = p_semester
          AND school_id = p_school_id
          AND subject_label IS NOT NULL
          AND TRIM(subject_label) <> ''
    LOOP
        SELECT subject_id INTO v_subj_id
        FROM subjects
        WHERE school_id = p_school_id AND is_active = true
          AND name ILIKE v_label
        LIMIT 1;

        IF v_subj_id IS NULL THEN
            SELECT subject_id INTO v_subj_id
            FROM subjects
            WHERE school_id = p_school_id AND is_active = true
              AND code ILIKE v_label
            LIMIT 1;
        END IF;

        IF v_subj_id IS NULL THEN
            INSERT INTO subjects (code, name, is_active, school_id)
            VALUES (
                UPPER(LEFT(REGEXP_REPLACE(v_label, '\s+', '_', 'g'), 20)),
                v_label,
                true,
                p_school_id
            )
            RETURNING subject_id INTO v_subj_id;
        END IF;
    END LOOP;

    INSERT INTO teaching_assignments
        (user_id, class_id, subject_id, academic_year, semester, is_active, school_id)
    SELECT DISTINCT
        t.teacher_id,
        t.class_id,
        COALESCE(
            (SELECT subject_id FROM subjects
             WHERE school_id = p_school_id AND is_active = true
               AND (name ILIKE t.subject_label OR code ILIKE t.subject_label)
             LIMIT 1),
            v_kbm_id
        ),
        p_academic_year,
        p_semester,
        true,
        p_school_id
    FROM schedule_templates t
    WHERE t.academic_year = p_academic_year
      AND t.semester      = p_semester
      AND t.school_id     = p_school_id
    ON CONFLICT (user_id, class_id, subject_id, academic_year, semester)
    DO UPDATE SET is_active = true;
    GET DIAGNOSTICS v_assigns = ROW_COUNT;

    UPDATE teaching_assignments ta
    SET    is_active = false
    WHERE  ta.school_id     = p_school_id
      AND  ta.academic_year = p_academic_year
      AND  ta.semester      = p_semester
      AND  ta.is_active     = true
      AND  NOT EXISTS (
               SELECT 1
               FROM   schedule_templates st
               WHERE  st.school_id     = p_school_id
                 AND  st.academic_year = p_academic_year
                 AND  st.semester      = p_semester
                 AND  st.teacher_id    = ta.user_id
                 AND  st.class_id      = ta.class_id
           );

    -- Sesi harian: generate dengan block_group_id via CTE window function.
    -- raw_slots: set lengkap slot dari template × generate_series
    -- ordered:   tambah LAG(session_end) sebagai prev_end per partisi
    -- flagged:   hitung is_new_block (1 = awal blok baru)
    -- grouped:   running SUM(is_new_block) = block_number per baris
    -- block_uuids: 1 UUID per (teacher,class,date,block_number) unik
    -- INSERT JOIN block_uuids: setiap baris dalam blok yang sama dapat UUID yang sama.
    --
    -- Known limitation: INSERT parsial ke tanggal yang sudah sebagian terisi
    -- dari template yang sama akan menghasilkan block_group_id berbeda dari
    -- sesi lama meski seharusnya satu blok. Tidak terjadi saat ini karena
    -- semua jalur reapply selalu DELETE penuh dulu sebelum re-INSERT.
    INSERT INTO teaching_schedules
        (assignment_id, class_id, subject_id, scheduled_teacher_id,
         session_date, session_start, session_end, subject_label,
         academic_year, semester, meeting_status, teacher_indicator,
         school_id, block_group_id)
    WITH raw_slots AS (
        SELECT
            a.assignment_id,
            t.class_id,
            COALESCE(
                (SELECT subject_id FROM subjects
                 WHERE school_id = p_school_id AND is_active = true
                   AND (name ILIKE t.subject_label OR code ILIKE t.subject_label)
                 LIMIT 1),
                v_kbm_id
            )                          AS subject_id,
            t.teacher_id               AS scheduled_teacher_id,
            gs.d::date                 AS session_date,
            t.start_time               AS session_start,
            t.end_time                 AS session_end,
            t.subject_label,
            p_academic_year            AS academic_year,
            p_semester                 AS semester,
            'NORMAL'::meeting_status   AS meeting_status,
            'PENDING_EVALUATION'::teacher_attendance_indicator AS teacher_indicator,
            p_school_id                AS school_id
        FROM schedule_templates t
        JOIN teaching_assignments a
          ON a.user_id       = t.teacher_id
         AND a.class_id      = t.class_id
         AND a.subject_id    = COALESCE(
                (SELECT subject_id FROM subjects
                 WHERE school_id = p_school_id AND is_active = true
                   AND (name ILIKE t.subject_label OR code ILIKE t.subject_label)
                 LIMIT 1),
                v_kbm_id
             )
         AND a.academic_year = p_academic_year
         AND a.semester      = p_semester
        JOIN generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') gs(d)
          ON extract(isodow from gs.d) = CASE t.day_of_week::text
                WHEN 'SENIN'  THEN 1 WHEN 'SELASA' THEN 2 WHEN 'RABU' THEN 3
                WHEN 'KAMIS'  THEN 4 WHEN 'JUMAT'  THEN 5 WHEN 'SABTU' THEN 6 END
        WHERE t.academic_year = p_academic_year
          AND t.semester      = p_semester
          AND t.school_id     = p_school_id
    ),
    ordered AS (
        SELECT *,
            LAG(session_end) OVER (
                PARTITION BY scheduled_teacher_id, class_id, session_date
                ORDER BY session_start
            ) AS prev_end
        FROM raw_slots
    ),
    flagged AS (
        SELECT *,
            CASE
                WHEN prev_end IS NULL THEN 1
                WHEN EXTRACT(EPOCH FROM (session_start - prev_end)) / 60 > 40 THEN 1
                ELSE 0
            END AS is_new_block
        FROM ordered
    ),
    grouped AS (
        SELECT *,
            SUM(is_new_block) OVER (
                PARTITION BY scheduled_teacher_id, class_id, session_date
                ORDER BY session_start
                ROWS UNBOUNDED PRECEDING
            ) AS block_number
        FROM flagged
    ),
    block_uuids AS (
        SELECT DISTINCT
            scheduled_teacher_id,
            class_id,
            session_date,
            block_number,
            gen_random_uuid() AS block_uuid
        FROM grouped
    )
    SELECT
        g.assignment_id,
        g.class_id,
        g.subject_id,
        g.scheduled_teacher_id,
        g.session_date,
        g.session_start,
        g.session_end,
        g.subject_label,
        g.academic_year,
        g.semester,
        g.meeting_status,
        g.teacher_indicator,
        g.school_id,
        bu.block_uuid
    FROM grouped g
    JOIN block_uuids bu
      ON  bu.scheduled_teacher_id = g.scheduled_teacher_id
      AND bu.class_id             = g.class_id
      AND bu.session_date         = g.session_date
      AND bu.block_number         = g.block_number
    ON CONFLICT (class_id, scheduled_teacher_id, session_date, session_start)
    DO NOTHING;
    GET DIAGNOSTICS v_schedules = ROW_COUNT;

    RETURN jsonb_build_object(
        'templates_found',      v_templates,
        'assignments_upserted', v_assigns,
        'schedules_generated',  v_schedules
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_attendance_fill_rate(p_date_start date DEFAULT NULL::date, p_date_end date DEFAULT NULL::date)
 RETURNS TABLE(teacher_indicator text, jumlah bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT
        ts.teacher_indicator::TEXT,
        COUNT(*)::BIGINT
    FROM teaching_schedules ts
    WHERE ts.school_id     = fn_current_school_id()
      AND ts.meeting_status = 'NORMAL'
      AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
      AND (p_date_end   IS NULL OR ts.session_date <= p_date_end)
    GROUP BY ts.teacher_indicator;
$function$;
CREATE OR REPLACE FUNCTION public.fn_attendance_period_lock()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_session_date DATE;
    v_school_id    UUID;
BEGIN
    SELECT session_date, school_id INTO v_session_date, v_school_id
    FROM teaching_schedules WHERE schedule_id = NEW.schedule_id;

    IF fn_is_period_closed(v_session_date, v_school_id) THEN
        RAISE EXCEPTION
            'Periode sudah ditutup untuk tanggal %. Tidak dapat menambah/mengubah absensi.',
            v_session_date USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_attendance_recap_per_class(p_date_start date DEFAULT NULL::date, p_date_end date DEFAULT NULL::date)
 RETURNS TABLE(class_id uuid, name text, hadir bigint, alpa bigint, izin bigint, sakit bigint, total bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT
        c.class_id,
        c.name,
        COUNT(DISTINCT CASE WHEN a.status = 'HADIR' THEN ts.block_group_id END) AS hadir,
        COUNT(DISTINCT CASE WHEN a.status = 'ALPA'  THEN ts.block_group_id END) AS alpa,
        COUNT(DISTINCT CASE WHEN a.status = 'IZIN'  THEN ts.block_group_id END) AS izin,
        COUNT(DISTINCT CASE WHEN a.status = 'SAKIT' THEN ts.block_group_id END) AS sakit,
        COUNT(DISTINCT CASE WHEN a.attendance_id IS NOT NULL THEN ts.block_group_id END) AS total
    FROM public.classes c
    LEFT JOIN public.teaching_schedules ts
           ON ts.class_id = c.class_id
          AND ts.school_id = public.fn_current_school_id()
          AND ts.academic_year = (
              SELECT sc.current_academic_year
              FROM public.school_config sc
              WHERE sc.school_id = public.fn_current_school_id()
          )
          AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
          AND (p_date_end IS NULL OR ts.session_date <= p_date_end)
    LEFT JOIN public.attendance a
           ON a.schedule_id = ts.schedule_id
          AND NOT a.is_void
    WHERE c.school_id = public.fn_current_school_id()
      AND c.is_active = TRUE
      AND (
          public.fn_current_user_role() = 'ADMINISTRATIVE'::public.role_type
          OR public.fn_is_schoolwide_observer()
          OR (
              public.fn_kaprodi_program_id() IS NOT NULL
              AND c.program_id = public.fn_kaprodi_program_id()
          )
      )
    GROUP BY c.class_id, c.name
    ORDER BY c.name;
$function$;
CREATE OR REPLACE FUNCTION public.fn_audit_log_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id uuid;
    v_row_id    text;
    v_row_json  jsonb;
BEGIN
    v_school_id := OLD.school_id;
    v_row_json  := to_jsonb(OLD);

    v_row_id := CASE TG_TABLE_NAME
        WHEN 'observations'  THEN v_row_json ->> 'observation_id'
        WHEN 'cases'         THEN v_row_json ->> 'case_id'
        WHEN 'case_events'   THEN v_row_json ->> 'event_id'
        ELSE                      'unknown'
    END;

    INSERT INTO audit_log (school_id, table_name, row_id, row_snapshot, deleted_by)
    VALUES (
        v_school_id,
        TG_TABLE_NAME,
        v_row_id,
        v_row_json,
        auth.uid()
    );

    RETURN OLD;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_auto_set_recorded_by()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NEW.recorded_by_user_id IS NULL THEN
        NEW.recorded_by_user_id := fn_current_user_id();
    END IF;
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_auto_set_school_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_sid uuid;
BEGIN
    IF NEW.school_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    v_sid := fn_current_school_id();

    IF v_sid IS NULL THEN
        CASE TG_TABLE_NAME
            WHEN 'students' THEN
                SELECT school_id INTO v_sid FROM programs WHERE program_id = NEW.program_id;
            WHEN 'classes' THEN
                SELECT school_id INTO v_sid FROM programs WHERE program_id = NEW.program_id;
            WHEN 'class_enrollments' THEN
                SELECT school_id INTO v_sid FROM classes WHERE class_id = NEW.class_id;
            WHEN 'teaching_assignments' THEN
                SELECT school_id INTO v_sid FROM classes WHERE class_id = NEW.class_id;
            WHEN 'teaching_schedules' THEN
                SELECT school_id INTO v_sid FROM classes WHERE class_id = NEW.class_id;
            WHEN 'schedule_templates' THEN
                SELECT school_id INTO v_sid FROM classes WHERE class_id = NEW.class_id;
            WHEN 'attendance' THEN
                SELECT school_id INTO v_sid FROM teaching_schedules WHERE schedule_id = NEW.schedule_id;
            WHEN 'teacher_attendance_log' THEN
                SELECT school_id INTO v_sid FROM teaching_schedules WHERE schedule_id = NEW.schedule_id;
            WHEN 'substitute_schedules' THEN
                SELECT school_id INTO v_sid FROM teaching_schedules WHERE schedule_id = NEW.schedule_id;
            WHEN 'observations' THEN
                SELECT school_id INTO v_sid FROM students WHERE student_id = NEW.student_id;
            WHEN 'achievements' THEN
                SELECT school_id INTO v_sid FROM students WHERE student_id = NEW.student_id;
            WHEN 'cases' THEN
                SELECT school_id INTO v_sid FROM students WHERE student_id = NEW.student_id;
            WHEN 'parent_messages' THEN
                SELECT school_id INTO v_sid FROM students WHERE student_id = NEW.student_id;
            WHEN 'student_parents' THEN
                SELECT school_id INTO v_sid FROM students WHERE student_id = NEW.student_id;
            WHEN 'pkl_placements' THEN
                SELECT school_id INTO v_sid FROM students WHERE student_id = NEW.student_id;
            WHEN 'case_events' THEN
                SELECT school_id INTO v_sid FROM cases WHERE case_id = NEW.case_id;
            WHEN 'student_updates' THEN
                SELECT school_id INTO v_sid FROM cases WHERE case_id = NEW.case_id;
            WHEN 'pkl_attendance' THEN
                SELECT school_id INTO v_sid FROM pkl_placements WHERE placement_id = NEW.placement_id;
            WHEN 'teacher_journals' THEN
                SELECT school_id INTO v_sid FROM users WHERE user_id = NEW.owner_user_id;
            ELSE
                v_sid := NULL;
        END CASE;
    END IF;

    NEW.school_id := v_sid;
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_batalkan_tahun_ajaran(p_config_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id       UUID;
    v_cur_year        TEXT;
    v_cur_sem         semester;
    v_prev_year       TEXT;
    v_prev_sem        semester;
    v_deleted_enroll  INTEGER := 0;
    v_restored        INTEGER := 0;
    v_deleted_periods INTEGER := 0;
BEGIN
    SELECT school_id, current_academic_year, current_semester
        INTO v_school_id, v_cur_year, v_cur_sem
        FROM school_config WHERE config_id = p_config_id;
    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'school_config dengan id % tidak ditemukan', p_config_id;
    END IF;

    IF auth.uid() IS NOT NULL AND (
           v_school_id IS DISTINCT FROM fn_current_school_id()
        OR NOT (fn_is_kepsek() OR fn_current_user_role() = 'ADMINISTRATIVE')
    ) THEN
        RAISE EXCEPTION 'akses ditolak: hanya admin/kepsek sekolah terkait'
            USING ERRCODE = '42501';
    END IF;

    SELECT academic_year, semester INTO v_prev_year, v_prev_sem
    FROM academic_periods
    WHERE school_id = v_school_id
      AND (academic_year < v_cur_year
           OR (academic_year = v_cur_year AND semester < v_cur_sem))
    ORDER BY academic_year DESC, semester DESC
    LIMIT 1;

    IF v_prev_year IS NULL THEN
        RAISE EXCEPTION 'Tidak ada tahun ajaran sebelumnya untuk dipulihkan. Pembatalan dihentikan demi keamanan.';
    END IF;

    UPDATE class_enrollments
        SET withdrawn_at = NULL, updated_at = now()
    WHERE school_id = v_school_id
      AND academic_year = v_prev_year
      AND withdrawn_at IS NOT NULL
      AND student_id IN (
          SELECT student_id FROM class_enrollments
          WHERE school_id = v_school_id AND academic_year = v_cur_year
      );
    GET DIAGNOSTICS v_restored = ROW_COUNT;

    DELETE FROM class_enrollments
    WHERE school_id = v_school_id AND academic_year = v_cur_year;
    GET DIAGNOSTICS v_deleted_enroll = ROW_COUNT;

    DELETE FROM academic_periods
    WHERE school_id = v_school_id AND academic_year = v_cur_year;
    GET DIAGNOSTICS v_deleted_periods = ROW_COUNT;

    UPDATE school_config
        SET current_academic_year = v_prev_year,
            current_semester      = v_prev_sem,
            updated_at            = now()
    WHERE config_id = p_config_id;

    RETURN jsonb_build_object(
        'success',              true,
        'cancelled_year',       v_cur_year,
        'cancelled_semester',   v_cur_sem,
        'restored_year',        v_prev_year,
        'restored_semester',    v_prev_sem,
        'deleted_enrollments',  v_deleted_enroll,
        'restored_enrollments', v_restored,
        'deleted_periods',      v_deleted_periods
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_buka_tahun_ajaran(p_config_id uuid, p_academic_year text, p_semester integer, p_start_date date, p_end_date date, p_old_academic_year text, p_promotion_mapping jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id       UUID;
    v_current_year    TEXT;
    v_period_id       UUID;
    v_enrolled_count  INTEGER := 0;
    v_item            JSONB;
    v_target_class    UUID;
    v_student_ids     UUID[];
    v_target_name     TEXT;
    v_class_exists    BOOLEAN;
    v_rows_inserted   INTEGER;
    v_slots_copied    INTEGER := 0;
BEGIN
    SELECT school_id, current_academic_year
      INTO v_school_id, v_current_year
    FROM school_config
    WHERE config_id = p_config_id;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'school_config dengan id % tidak ditemukan', p_config_id;
    END IF;

    -- Direct authenticated calls must stay inside the caller's tenant.
    -- The Edge Function also validates this before using service_role.
    IF auth.uid() IS NOT NULL AND (
        v_school_id IS DISTINCT FROM fn_current_school_id()
        OR fn_current_user_role() <> 'ADMINISTRATIVE'
    ) THEN
        RAISE EXCEPTION 'akses ditolak: hanya admin sekolah terkait'
            USING ERRCODE = '42501';
    END IF;

    IF p_old_academic_year IS DISTINCT FROM v_current_year THEN
        RAISE EXCEPTION 'tahun ajaran lama tidak sesuai konfigurasi sekolah';
    END IF;

    IF EXISTS (
        SELECT 1 FROM academic_periods
        WHERE academic_year = p_academic_year
          AND semester = p_semester::text::semester
          AND school_id = v_school_id
    ) THEN
        RAISE EXCEPTION 'Periode % Semester % sudah ada di database',
            p_academic_year, p_semester;
    END IF;

    UPDATE school_config
    SET current_academic_year = p_academic_year,
        current_semester      = p_semester::text::semester,
        updated_at            = NOW()
    WHERE config_id = p_config_id
      AND school_id = v_school_id;

    UPDATE classes
    SET academic_year = p_academic_year,
        updated_at    = NOW()
    WHERE school_id = v_school_id
      AND academic_year = p_old_academic_year;

    INSERT INTO academic_periods
        (academic_year, semester, start_date, end_date, status, school_id)
    VALUES
        (p_academic_year, p_semester::text::semester, p_start_date, p_end_date, 'ACTIVE', v_school_id)
    RETURNING id INTO v_period_id;

    INSERT INTO schedule_time_slots
        (academic_year, semester, day_of_week, slot_number,
         start_time, end_time, is_break, break_label, school_id)
    SELECT
        p_academic_year, p_semester::text::semester, day_of_week, slot_number,
        start_time, end_time, is_break, break_label, school_id
    FROM schedule_time_slots
    WHERE school_id = v_school_id
      AND academic_year = p_old_academic_year
      AND semester = p_semester::text::semester
    ON CONFLICT (school_id, academic_year, semester, day_of_week, slot_number) DO NOTHING;

    GET DIAGNOSTICS v_slots_copied = ROW_COUNT;

    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_promotion_mapping, '[]'::jsonb))
    LOOP
        v_target_class := (v_item->>'targetClassId')::UUID;
        v_target_name  := v_item->>'targetName';
        v_student_ids  := ARRAY(
            SELECT (el::text)::UUID
            FROM jsonb_array_elements_text(COALESCE(v_item->'studentIds', '[]'::jsonb)) el
        );

        SELECT EXISTS(
            SELECT 1 FROM classes
            WHERE class_id = v_target_class
              AND school_id = v_school_id
        ) INTO v_class_exists;

        IF NOT v_class_exists THEN
            RAISE EXCEPTION 'Kelas "%" (id: %) tidak ditemukan di sekolah ini',
                v_target_name, v_target_class;
        END IF;

        IF EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(COALESCE(v_item->'studentIds', '[]'::jsonb)) el
            LEFT JOIN students s ON s.student_id = (el::text)::UUID
            WHERE s.student_id IS NULL OR s.school_id IS DISTINCT FROM v_school_id
        ) THEN
            RAISE EXCEPTION 'Mapping berisi siswa dari sekolah lain atau siswa yang tidak ditemukan'
                USING ERRCODE = '42501';
        END IF;

        IF v_student_ids IS NULL OR array_length(v_student_ids, 1) IS NULL THEN
            CONTINUE;
        END IF;

        UPDATE class_enrollments
        SET withdrawn_at = NOW(), updated_at = NOW()
        WHERE school_id = v_school_id
          AND student_id = ANY(v_student_ids)
          AND academic_year = p_old_academic_year
          AND withdrawn_at IS NULL;

        INSERT INTO class_enrollments
            (student_id, class_id, academic_year, semester)
        SELECT unnest(v_student_ids), v_target_class,
               p_academic_year, p_semester::text::semester
        ON CONFLICT (student_id, academic_year, semester) DO NOTHING;

        GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;
        v_enrolled_count := v_enrolled_count + v_rows_inserted;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true, 'period_id', v_period_id,
        'enrolled_count', v_enrolled_count, 'slots_copied', v_slots_copied
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_bulk_import_students(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_row           JSONB;
    v_student_id    UUID;
    v_success_count INTEGER := 0;
    v_errors        JSONB := '[]'::JSONB;
    v_row_index     INTEGER := 0;
BEGIN
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
    LOOP
        v_row_index := v_row_index + 1;

        BEGIN
            INSERT INTO students (nis, full_name, program_id, student_status)
            VALUES (
                v_row->>'nis',
                v_row->>'full_name',
                (v_row->>'program_id')::UUID,
                'AKTIF'
            )
            RETURNING student_id INTO v_student_id;

            INSERT INTO class_enrollments (
                student_id, class_id, academic_year, semester
            )
            VALUES (
                v_student_id,
                (v_row->>'class_id')::UUID,
                v_row->>'academic_year',
                (v_row->>'semester')::semester
            );

            v_success_count := v_success_count + 1;

        EXCEPTION WHEN OTHERS THEN
            -- Rolls back only this row's inserts (savepoint semantics
            -- of a plpgsql sub-block), batch continues.
            v_errors := v_errors || jsonb_build_object(
                'row_index', v_row_index,
                'nis',       v_row->>'nis',
                'message',   SQLERRM
            );
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'success', v_success_count,
        'failed',  jsonb_array_length(v_errors),
        'errors',  v_errors
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_can_manage_pkl_student(p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.users u
        JOIN public.students s ON s.student_id = p_student_id
        WHERE u.auth_user_id = auth.uid()
          AND u.school_id = public.fn_current_school_id()
          AND s.school_id = public.fn_current_school_id()
          AND (
              u.role_type IN ('ADMINISTRATIVE', 'KEPSEK')
              OR u.is_kepsek
              OR (
                  public.fn_kaprodi_program_id() IS NOT NULL
                  AND s.program_id = public.fn_kaprodi_program_id()
              )
          )
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_can_read_forum_post(p_post_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_class_id      UUID;
    v_academic_year TEXT;
    v_visibility    TEXT;
    v_author_id     UUID;
    v_school_id     UUID;
    v_is_withdrawn  BOOLEAN;
    v_scope_type    TEXT;
    v_caller_id     UUID := fn_current_user_id();
BEGIN
    SELECT fp.class_id, fp.academic_year, fp.visibility,
           fp.author_user_id, fp.school_id, fp.is_withdrawn,
           fp.scope_type
    INTO   v_class_id, v_academic_year, v_visibility,
           v_author_id, v_school_id, v_is_withdrawn,
           v_scope_type
    FROM   forum_posts fp
    WHERE  fp.post_id   = p_post_id
      AND  fp.school_id = fn_current_school_id();

    IF NOT FOUND THEN RETURN false; END IF;

    -- FUNC-02: gerbang "tarik posting", berlaku untuk SEMUA scope.
    -- Blok ini sebelumnya berada DI BAWAH short-circuit scope SEKOLAH
    -- sehingga tidak pernah dievaluasi untuk posting sekolah. Isinya
    -- tidak diubah; hanya posisinya dinaikkan agar semantik "tarik
    -- posting" sama persis di scope KELAS maupun SEKOLAH.
    IF v_is_withdrawn THEN
        RETURN v_caller_id = v_author_id
            OR fn_current_user_role() IN ('KEPSEK', 'WAKA_KESISWAAN', 'ADMINISTRATIVE')
            OR EXISTS (
                SELECT 1 FROM users u
                WHERE  u.user_id   = v_caller_id
                  AND  u.school_id = v_school_id
                  AND  (u.is_kepsek = true OR u.is_waka_kesiswaan = true)
                  AND  u.is_active = true AND u.deleted_at IS NULL
            );
    END IF;

    -- Short-circuit untuk scope_type = 'SEKOLAH'
    IF v_scope_type = 'SEKOLAH' THEN
        -- Author selalu bisa baca postingnya sendiri, aktif atau tidak.
        IF v_author_id = v_caller_id THEN RETURN true; END IF;
        -- EDGE-01: cek keanggotaan audience DAN status aktif caller.
        -- Sebelum fix ini cabang SEKOLAH hanya mengecek keberadaan baris
        -- di forum_post_audience — tanpa users.is_active / deleted_at —
        -- sehingga staf yang resign, siswa yang keluar, atau ortu yang
        -- dinonaktifkan tetap bisa membaca pengumuman se-sekolah selama
        -- barisnya tertinggal di audience. Tidak ada trigger di tabel
        -- users maupun migration yang membersihkan forum_post_audience.
        -- Guard is_active + deleted_at dipilih karena berlaku seragam
        -- untuk SEMUA peran; students.student_status hanya menutup siswa.
        -- Bandingkan cabang KELAS (poin 9) yang sudah punya guard serupa.
        RETURN EXISTS (
            SELECT 1
            FROM   public.forum_post_audience fpa
            JOIN   public.users u ON u.user_id = fpa.user_id
            WHERE  fpa.post_id   = p_post_id
              AND  fpa.user_id   = v_caller_id
              AND  u.is_active   = true
              AND  u.deleted_at IS NULL
        );
    END IF;

    -- 1. Penulis selalu bisa baca posting sendiri
    IF fn_current_user_id() = v_author_id THEN RETURN true; END IF;

    -- 2. Waka Kesiswaan / Kepsek / Administrative: akses ke seluruh forum
    --    Cek role_type PLUS flag jabatan tambahan (multi-role)
    IF fn_current_user_role() IN ('KEPSEK', 'WAKA_KESISWAAN', 'ADMINISTRATIVE')
       OR EXISTS (
           SELECT 1 FROM users u
           WHERE  u.user_id   = fn_current_user_id()
             AND  u.school_id = v_school_id
             AND  (u.is_waka_kesiswaan = true OR u.is_kepsek = true)
             AND  u.is_active = true AND u.deleted_at IS NULL
       )
    THEN RETURN true; END IF;

    -- 3. Kaprodi yang mengelola program kelas ini
    --    Cek users.program_id (primary kaprodi) ATAU
    --    users.kaprodi_program_id (jabatan tambahan)
    IF EXISTS (
        SELECT 1
        FROM   users u
        JOIN   classes c ON c.class_id = v_class_id
        WHERE  u.user_id   = fn_current_user_id()
          AND  u.school_id = v_school_id
          AND  u.is_active = true
          AND  u.deleted_at IS NULL
          AND  (u.program_id = c.program_id
                OR u.kaprodi_program_id = c.program_id)
          AND  c.program_id IS NOT NULL
    ) THEN RETURN true; END IF;

    -- 4. Wali Kelas untuk kelas ini
    IF EXISTS (
        SELECT 1 FROM users u
        WHERE  u.user_id             = fn_current_user_id()
          AND  u.wali_kelas_class_id = v_class_id
          AND  u.school_id           = v_school_id
          AND  u.is_active = true AND u.deleted_at IS NULL
    ) THEN RETURN true; END IF;

    -- 5. Guru Mapel yang mengajar kelas ini
    IF EXISTS (
        SELECT 1 FROM teaching_assignments ta
        WHERE  ta.user_id       = fn_current_user_id()
          AND  ta.class_id      = v_class_id
          AND  ta.academic_year = v_academic_year
          AND  ta.is_active     = true
          AND  ta.school_id     = v_school_id
    ) THEN RETURN true; END IF;

    -- 6. Guru Wali: HANYA posting yang subjeknya adalah siswa tanggungannya
    --    (FIX: sebelumnya akses ke semua posting kelas)
    IF EXISTS (
        SELECT 1
        FROM   guru_wali_assignments gwa
        JOIN   forum_post_subjects fps
               ON  fps.student_id = gwa.student_id
               AND fps.post_id    = p_post_id
               AND fps.school_id  = v_school_id
        WHERE  gwa.guru_user_id  = fn_current_user_id()
          AND  gwa.academic_year = v_academic_year
          AND  gwa.is_active     = true
          AND  gwa.school_id     = v_school_id
    ) THEN RETURN true; END IF;

    -- 7. BK: HANYA posting yang punya setidaknya satu subjek siswa
    --    (FIX: sebelumnya akses ke semua posting termasuk pengumuman)
    IF EXISTS (
        SELECT 1 FROM bk_class_assignments bca
        WHERE  bca.bk_user_id    = fn_current_user_id()
          AND  bca.class_id      = v_class_id
          AND  bca.academic_year = v_academic_year
          AND  bca.is_active     = true
          AND  bca.school_id     = v_school_id
    ) AND EXISTS (
        SELECT 1 FROM forum_post_subjects fps
        WHERE  fps.post_id   = p_post_id
          AND  fps.school_id = v_school_id
    ) THEN RETURN true; END IF;

    -- 8. Ortu siswa aktif di kelas (hanya PARENT_VISIBLE)
    IF v_visibility = 'PARENT_VISIBLE' AND EXISTS (
        SELECT 1
        FROM   student_parents sp
        JOIN   class_enrollments ce ON ce.student_id = sp.student_id
        WHERE  sp.parent_user_id = fn_current_user_id()
          AND  sp.school_id      = v_school_id
          AND  ce.class_id       = v_class_id
          AND  ce.academic_year  = v_academic_year
          AND  ce.withdrawn_at   IS NULL
          AND  ce.school_id      = v_school_id
    ) THEN RETURN true; END IF;

    -- 9. Siswa: terdaftar aktif di kelas DAN ada di audience posting ini
    IF EXISTS (
        SELECT 1
        FROM   students s
        JOIN   class_enrollments ce ON ce.student_id = s.student_id
        WHERE  s.user_id        = fn_current_user_id()
          AND  s.school_id      = v_school_id
          AND  s.student_status = 'AKTIF'
          AND  ce.class_id      = v_class_id
          AND  ce.academic_year = v_academic_year
          AND  ce.withdrawn_at  IS NULL
          AND  ce.school_id     = v_school_id
          AND  EXISTS (
                   SELECT 1 FROM forum_post_audience fpa
                   WHERE  fpa.post_id = p_post_id
                     AND  fpa.user_id = fn_current_user_id()
               )
    ) THEN RETURN true; END IF;

    RETURN false;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_can_see_coaching_case(p_case_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.coaching_cases c
        WHERE c.case_id = p_case_id
          AND c.school_id = public.fn_current_school_id()
          AND (
              c.created_by_user_id = public.fn_current_user_id()
              OR EXISTS (
                  SELECT 1
                  FROM public.coaching_case_handlers h
                  WHERE h.case_id = p_case_id
                    AND h.handler_user_id = public.fn_current_user_id()
              )
              OR public.fn_current_user_role() = 'ADMINISTRATIVE'::public.role_type
              OR public.fn_is_kepsek()
              OR public.fn_is_waka_kesiswaan()
          )
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_can_see_student(p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT public.fn_student_in_current_school(p_student_id)
       AND (
            public.fn_is_schoolwide_observer()
         OR public.fn_teaches_student(p_student_id)
         OR public.fn_wali_of_student(p_student_id)
         OR public.fn_kaprodi_of_student(p_student_id)
       );
$function$;
CREATE OR REPLACE FUNCTION public.fn_case_events_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION
            'domain_invariant_violation: case_events is append-only. UPDATE is not permitted. '
            'event_id=%',
            OLD.event_id
            USING ERRCODE = 'P0001';
    ELSIF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'domain_invariant_violation: case_events is append-only. DELETE is not permitted. '
            'event_id=%',
            OLD.event_id
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NULL;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_case_events_no_closed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_status case_status;
BEGIN
    SELECT status INTO v_status
    FROM cases
    WHERE case_id = NEW.case_id;

    IF v_status = 'CLOSED' THEN
        RAISE EXCEPTION
            'domain_invariant_violation (INV-1): cannot add event to a CLOSED case. '
            'case_id=%',
            NEW.case_id
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_case_initiated_by_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.initiated_by_role IS DISTINCT FROM OLD.initiated_by_role THEN
        RAISE EXCEPTION
            'domain_invariant_violation: initiated_by_role is immutable. case_id=%',
            OLD.case_id
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_check_assessment_criteria_overlap()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_conflict_predikat TEXT;
BEGIN
    SELECT predikat INTO v_conflict_predikat
    FROM assessment_criteria
    WHERE learning_objective_id = NEW.learning_objective_id
      AND (TG_OP = 'INSERT' OR criterion_id <> NEW.criterion_id)
      AND batas_bawah < NEW.batas_atas
      AND batas_atas  > NEW.batas_bawah
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION
            'Range %.2f–%.2f tumpang tindih dengan predikat "%"',
            NEW.batas_bawah, NEW.batas_atas, v_conflict_predikat;
    END IF;
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_check_element_duplicate(p_element_id uuid, p_school_id uuid, p_lo_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_agg(
        jsonb_build_object(
            'kode_tp',      lo.kode_tp,
            'deskripsi_tp', lo.deskripsi_tp,
            'guru_nama',    u.full_name,
            'kelas_nama',   c.name,
            'mapel_nama',   s.name
        )
    ) INTO v_result
    FROM public.learning_objectives lo
    JOIN public.teaching_assignments ta ON ta.user_id    = lo.teacher_user_id
                                       AND ta.subject_id = lo.subject_id
                                       AND ta.school_id  = lo.school_id
                                       AND ta.is_active  = true
    JOIN public.classes c  ON c.class_id   = ta.class_id
    JOIN public.users   u  ON u.user_id    = lo.teacher_user_id
    JOIN public.subjects s ON s.subject_id = lo.subject_id
    WHERE lo.element_id = p_element_id
      AND lo.school_id  = p_school_id
      AND lo.is_active  = true
      AND (p_lo_id IS NULL OR lo.learning_objective_id != p_lo_id);

    RETURN COALESCE(v_result, '[]'::JSONB);
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_check_identifiers_exist(p_identifiers text[], p_school_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT ARRAY(
        SELECT login_identifier
        FROM users
        WHERE login_identifier = ANY(p_identifiers)
          AND school_id = p_school_id
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_check_kktp_no_overlap()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.assessment_criteria
        WHERE learning_objective_id = NEW.learning_objective_id
          AND id <> COALESCE(NEW.id, gen_random_uuid())
          AND NOT (batas_atas <= NEW.batas_bawah OR batas_bawah >= NEW.batas_atas)
    ) THEN
        RAISE EXCEPTION 'Range nilai tumpang tindih dengan KKTP lain';
    END IF;
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_check_niks_exist(p_niks text[], p_school_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    SELECT ARRAY(
        SELECT login_identifier
        FROM users
        WHERE login_identifier = ANY(p_niks)
          AND school_id = p_school_id
          AND deleted_at IS NULL
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_class_attendance_summary(p_class_id uuid, p_academic_year text, p_date_start date DEFAULT NULL::date, p_date_end date DEFAULT NULL::date, p_teacher_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(student_id uuid, full_name text, nis text, hadir bigint, alpa bigint, izin bigint, sakit bigint, total bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.auth_user_id = auth.uid()
          AND u.school_id = public.fn_current_school_id()
          AND u.is_active
          AND u.role_type IN ('GURU','WALI_KELAS','BK','KAPRODI','KEPSEK',
                              'WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS')
    ) THEN
        RAISE EXCEPTION 'Tidak berwenang membaca rekap absensi' USING ERRCODE = '42501';
    END IF;
    IF p_date_start > p_date_end THEN
        RAISE EXCEPTION 'Rentang tanggal tidak valid' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT
        s.student_id,
        s.full_name::text,
        s.nis::text,
        COUNT(DISTINCT CASE WHEN a.status = 'HADIR' THEN ts.block_group_id END),
        COUNT(DISTINCT CASE WHEN a.status = 'ALPA'  THEN ts.block_group_id END),
        COUNT(DISTINCT CASE WHEN a.status = 'IZIN'  THEN ts.block_group_id END),
        COUNT(DISTINCT CASE WHEN a.status = 'SAKIT' THEN ts.block_group_id END),
        COUNT(DISTINCT CASE WHEN a.attendance_id IS NOT NULL THEN ts.block_group_id END)
    FROM public.class_enrollments ce
    JOIN public.students s ON s.student_id = ce.student_id
    LEFT JOIN public.teaching_schedules ts
           ON ts.class_id = p_class_id
          AND ts.school_id = public.fn_current_school_id()
          AND ts.academic_year = p_academic_year
          AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
          AND (p_date_end IS NULL OR ts.session_date <= p_date_end)
          AND (p_teacher_id IS NULL OR ts.scheduled_teacher_id = p_teacher_id)
    LEFT JOIN public.attendance a
           ON a.schedule_id = ts.schedule_id
          AND a.student_id = s.student_id
          AND a.school_id = public.fn_current_school_id()
          AND NOT a.is_void
    WHERE ce.class_id = p_class_id
      AND ce.school_id = public.fn_current_school_id()
      AND ce.academic_year = p_academic_year
      AND ce.withdrawn_at IS NULL
      AND s.student_status = 'AKTIF'
      AND s.school_id = public.fn_current_school_id()
      AND public.fn_can_see_student(s.student_id)
    GROUP BY s.student_id, s.full_name, s.nis
    ORDER BY s.full_name;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_close_semester(p_period_id uuid, p_config_id uuid, p_semester text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF fn_current_user_role() <> 'ADMINISTRATIVE' THEN
        RAISE EXCEPTION 'akses ditolak: hanya ADMINISTRATIVE yang dapat menutup semester'
            USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM academic_periods
        WHERE id = p_period_id
          AND school_id = fn_current_school_id()
    ) THEN
        RAISE EXCEPTION 'domain_invariant_violation: period tidak ditemukan di sekolah ini';
    END IF;

    UPDATE academic_periods
    SET status            = 'CLOSED',
        closed_at         = now(),
        closed_by_user_id = auth.uid()
    WHERE id = p_period_id
      AND school_id = fn_current_school_id();

    IF p_semester = '1' THEN
        UPDATE school_config
        SET current_semester = '2'
        WHERE config_id = p_config_id
          AND school_id = fn_current_school_id();
    END IF;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_coaching_case_audit_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    INSERT INTO audit_log (school_id, table_name, row_id, row_snapshot, deleted_by)
    VALUES (
        OLD.school_id,
        'coaching_cases',
        OLD.case_id::text,
        -- Seluruh baris lama + deletion_reason dari session setting
        to_jsonb(OLD) || jsonb_build_object(
            'deletion_reason', current_setting('app.coaching_delete_reason', TRUE)
        ),
        auth.uid()
    );
    RETURN OLD;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_coaching_case_events_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION 'coaching_case_events is append-only. DELETE and UPDATE are not permitted.'
        USING ERRCODE = 'P0003';
    RETURN NULL;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_coaching_case_events_no_closed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF EXISTS (
        SELECT 1 FROM coaching_cases
        WHERE case_id = NEW.case_id AND status = 'CLOSED'
    ) THEN
        RAISE EXCEPTION 'case_closed: tidak bisa menambah event ke kasus yang sudah ditutup. case_id=%', NEW.case_id
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_coaching_case_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- T1-07: dulu memeriksa GUC app.coaching_sync_active, yang bisa disetel
    -- siapa saja lewat set_config() sehingga guard ini bisa dilucuti klien.
    -- pg_trigger_depth() tidak bisa dipalsukan dari luar. Fungsi ini berjalan
    -- SEBAGAI trigger, jadi kedalamannya (terukur):
    --   1 = UPDATE datang langsung dari klien                -> guard HARUS aktif
    --   2 = UPDATE datang dari fn_coaching_case_sync_handler -> guard dilewati
    IF pg_trigger_depth() <= 1 THEN
        IF NEW.current_handler_user_id IS DISTINCT FROM OLD.current_handler_user_id
        OR NEW.status                  IS DISTINCT FROM OLD.status
        OR NEW.is_shared_to_student    IS DISTINCT FROM OLD.is_shared_to_student
        OR NEW.is_shared_to_parent     IS DISTINCT FROM OLD.is_shared_to_parent
        OR NEW.closed_at               IS DISTINCT FROM OLD.closed_at
        OR NEW.closed_by_user_id       IS DISTINCT FROM OLD.closed_by_user_id
        THEN
            RAISE EXCEPTION
                'integrity_guard: gunakan INSERT ke coaching_case_events untuk mengubah state kasus. '
                'Direct UPDATE tidak diizinkan. case_id=%', OLD.case_id
                USING ERRCODE = 'P0003';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_coaching_case_immutable_creator()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
    OR NEW.student_id         IS DISTINCT FROM OLD.student_id
    OR NEW.created_at         IS DISTINCT FROM OLD.created_at
    OR NEW.school_id          IS DISTINCT FROM OLD.school_id
    THEN
        RAISE EXCEPTION
            'immutable_field: created_by_user_id, student_id, created_at, school_id '
            'tidak bisa diubah setelah kasus dibuat. case_id=%', OLD.case_id
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_coaching_case_log_create()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    PERFORM set_config('app.coaching_sync_active', 'true', true);

    INSERT INTO coaching_case_events (
        case_id, school_id, event_type, author_user_id,
        is_visible_to_student, payload
    ) VALUES (
        NEW.case_id, NEW.school_id, 'OPENED', NEW.created_by_user_id,
        FALSE,
        jsonb_build_object('text', NEW.description)
    );

    INSERT INTO coaching_case_handlers (
        case_id, school_id, handler_user_id, assigned_by_user_id
    ) VALUES (
        NEW.case_id, NEW.school_id, NEW.created_by_user_id, NEW.created_by_user_id
    );

    PERFORM set_config('app.coaching_sync_active', 'false', true);
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_coaching_case_sync_handler()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_new_handler_user_id UUID;
    v_new_status          case_status;
BEGIN
    -- OPENED dan NOTE_ADDED tidak mengubah state coaching_cases
    IF NEW.event_type IN ('NOTE_ADDED', 'OPENED') THEN
        RETURN NEW;
    END IF;

    PERFORM set_config('app.coaching_sync_active', 'true', true);

    IF NEW.event_type = 'ESCALATED' THEN
        v_new_handler_user_id := (NEW.payload->>'new_handler_user_id')::uuid;

        -- Tutup handler aktif sekarang
        UPDATE coaching_case_handlers
        SET handover_at = NOW()
        WHERE case_id   = NEW.case_id
          AND handover_at IS NULL;

        -- Buka handler baru
        INSERT INTO coaching_case_handlers (
            case_id, school_id, handler_user_id, assigned_by_user_id
        ) VALUES (
            NEW.case_id, NEW.school_id, v_new_handler_user_id, NEW.author_user_id
        );

        -- Update denormalized field di coaching_cases
        UPDATE coaching_cases
        SET current_handler_user_id = v_new_handler_user_id,
            updated_at              = NOW()
        WHERE case_id   = NEW.case_id
          AND school_id = NEW.school_id;

    ELSIF NEW.event_type = 'STATUS_CHANGED' THEN
        v_new_status := (NEW.payload->>'new_status')::case_status;
        UPDATE coaching_cases
        SET status     = v_new_status,
            updated_at = NOW()
        WHERE case_id   = NEW.case_id
          AND school_id = NEW.school_id;

    ELSIF NEW.event_type = 'CASE_EDITED' THEN
        UPDATE coaching_cases
        SET title       = COALESCE(NULLIF(NEW.payload->>'new_title', ''),       title),
            description = COALESCE(NULLIF(NEW.payload->>'new_description', ''), description),
            updated_at  = NOW()
        WHERE case_id   = NEW.case_id
          AND school_id = NEW.school_id;

    ELSIF NEW.event_type = 'SHARED_TO_STUDENT' THEN
        UPDATE coaching_cases
        SET is_shared_to_student = TRUE,
            updated_at           = NOW()
        WHERE case_id   = NEW.case_id
          AND school_id = NEW.school_id;

    ELSIF NEW.event_type = 'UNSHARED_FROM_STUDENT' THEN
        UPDATE coaching_cases
        SET is_shared_to_student = FALSE,
            updated_at           = NOW()
        WHERE case_id   = NEW.case_id
          AND school_id = NEW.school_id;

    ELSIF NEW.event_type = 'SHARED_TO_PARENT' THEN
        UPDATE coaching_cases
        SET is_shared_to_parent = TRUE,
            updated_at          = NOW()
        WHERE case_id   = NEW.case_id
          AND school_id = NEW.school_id;

    ELSIF NEW.event_type = 'UNSHARED_FROM_PARENT' THEN
        UPDATE coaching_cases
        SET is_shared_to_parent = FALSE,
            updated_at          = NOW()
        WHERE case_id   = NEW.case_id
          AND school_id = NEW.school_id;

    ELSIF NEW.event_type = 'CLOSED' THEN
        UPDATE coaching_cases
        SET status            = 'CLOSED',
            closed_at         = NOW(),
            closed_by_user_id = NEW.author_user_id,
            updated_at        = NOW()
        WHERE case_id   = NEW.case_id
          AND school_id = NEW.school_id;

    END IF;

    PERFORM set_config('app.coaching_sync_active', 'false', true);
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_confirm_password_changed()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Set bypass flag sebelum UPDATE — LOCAL (parameter ke-3 = true)
    -- berarti flag reset otomatis di akhir transaksi ini saja.
    PERFORM set_config('app.bypass_users_guard', 'on', true);

    UPDATE users
    SET must_change_password = false,
        password_changed_at  = now()
    WHERE auth_user_id = auth.uid();
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_count_unread_notifications()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT count(*)
    FROM   notifications
    WHERE  recipient_user_id = fn_current_user_id()
      AND  school_id         = fn_current_school_id()
      AND  is_read           = false;
$function$;
CREATE OR REPLACE FUNCTION public.fn_create_forum_post(p_class_id uuid, p_academic_year text, p_content text, p_category_code text DEFAULT NULL::text, p_subject_student_ids uuid[] DEFAULT '{}'::uuid[], p_audience_type text DEFAULT 'STAF_SAJA'::text, p_specific_user_ids uuid[] DEFAULT '{}'::uuid[], p_audience_type_2 text DEFAULT NULL::text, p_specific_user_ids_2 uuid[] DEFAULT '{}'::uuid[], p_scope_type text DEFAULT 'KELAS'::text, p_title text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_caller_id      UUID   := fn_current_user_id();
    v_school_id      UUID   := fn_current_school_id();
    v_post_id        UUID   := gen_random_uuid();
    v_category_id    UUID;
    v_visibility     TEXT;
    v_title          TEXT;
    v_author_name    TEXT;
    v_class_name     TEXT;
    v_audience_ids   UUID[] := ARRAY[]::UUID[];
    v_audience_ids_2 UUID[] := ARRAY[]::UUID[];
    v_caller_role    TEXT;
    v_existing_id    UUID;
BEGIN
    -- ── FUNC-03: short-circuit idempotency ────────────────────
    -- Request ulang dengan kunci yang sama mengembalikan posting yang
    -- sudah ada; tidak ada INSERT, tidak ada notifikasi kedua.
    IF p_idempotency_key IS NOT NULL THEN
        SELECT fp.post_id INTO v_existing_id
        FROM   forum_posts fp
        WHERE  fp.school_id       = v_school_id
          AND  fp.author_user_id  = v_caller_id
          AND  fp.idempotency_key = p_idempotency_key;
        IF v_existing_id IS NOT NULL THEN
            RETURN v_existing_id;
        END IF;
    END IF;

    -- ── Validasi konten ───────────────────────────────────────
    IF p_content IS NULL OR length(trim(p_content)) < 3 THEN
        RAISE EXCEPTION 'Isi posting minimal 3 karakter.';
    END IF;

    -- ════════════════════════════════════════════════════════
    -- PATH A: scope_type = 'SEKOLAH'
    -- ════════════════════════════════════════════════════════
    IF p_scope_type = 'SEKOLAH' THEN

        -- Judul wajib untuk forum sekolah
        IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
            RAISE EXCEPTION 'Judul posting wajib diisi untuk forum sekolah.';
        END IF;

        v_title      := trim(p_title);
        v_visibility := 'INTERNAL';

        -- Ambil role caller untuk menentukan label notifikasi
        SELECT role_type INTO v_caller_role FROM users WHERE user_id = v_caller_id;

        -- ── RLS-01: guard peran penulis untuk PATH A (scope SEKOLAH) ──
        -- Sebelum fix ini PATH A sama sekali tidak memeriksa peran caller:
        -- v_caller_role hanya dipakai untuk memilih label notifikasi.
        -- Karena fungsi ini SECURITY DEFINER, siapa pun yang punya EXECUTE
        -- (termasuk SISWA, DUDI, STAKEHOLDER) bisa membuat pengumuman
        -- se-sekolah dan mem-blast notifikasi ke staf.
        -- ORTU sengaja DIIZINKAN agar fitur "Kabar Ortu"
        -- (migration 20260826000000) tetap berfungsi.
        -- Catatan: v_caller_role bertipe TEXT (lihat DECLARE), jadi
        -- perbandingan memakai literal text polos, bukan ::role_type.
        -- Cek IS NULL wajib: NULL NOT IN (...) menghasilkan NULL sehingga
        -- cabang IF tidak diambil dan guard akan terlewat.
        IF v_caller_role IS NULL OR v_caller_role NOT IN (
            'GURU', 'BK', 'WALI_KELAS', 'KAPRODI',
            'WAKA_KESISWAAN', 'WAKA_KURIKULUM', 'WAKA_HUMAS',
            'KEPSEK', 'TU', 'ADMINISTRATIVE', 'ORTU'
        ) THEN
            RAISE EXCEPTION
                'Akses ditolak: peran "%" tidak diizinkan membuat posting forum sekolah.',
                coalesce(v_caller_role, '(tidak dikenal)')
                USING ERRCODE = 'P0001';
        END IF;

        -- Resolve category_id
        IF p_category_code IS NOT NULL AND trim(p_category_code) <> '' THEN
            SELECT category_id INTO v_category_id
            FROM   communication_categories
            WHERE  category_code = p_category_code AND is_active = true;
        END IF;

        -- INSERT forum_posts (class_id = NULL, scope_type = 'SEKOLAH')
        -- FUNC-03: pembungkus unique_violation menutup race condition dua
        -- request bersamaan dengan idempotency_key yang sama.
        BEGIN
            INSERT INTO forum_posts (
                post_id, school_id, class_id, category_id, author_user_id,
                academic_year, title, body, visibility,
                audience_type, audience_type_2, scope_type, idempotency_key
            ) VALUES (
                v_post_id, v_school_id, NULL, v_category_id, v_caller_id,
                p_academic_year, v_title, p_content, v_visibility,
                p_audience_type, p_audience_type_2, 'SEKOLAH', p_idempotency_key
            );
        EXCEPTION WHEN unique_violation THEN
            SELECT fp.post_id INTO v_existing_id
            FROM   forum_posts fp
            WHERE  fp.school_id       = v_school_id
              AND  fp.author_user_id  = v_caller_id
              AND  fp.idempotency_key = p_idempotency_key;
            IF v_existing_id IS NOT NULL THEN
                RETURN v_existing_id;
            END IF;
            RAISE;
        END;

        -- Saring penerima: harus anggota sekolah yang sama dan aktif.
        -- Cross-tenant isolation dijaga oleh AND u.school_id = v_school_id.
        v_audience_ids :=
            ARRAY(
                SELECT DISTINCT uid
                FROM unnest(
                    COALESCE(p_specific_user_ids,   ARRAY[]::UUID[]) ||
                    COALESCE(p_specific_user_ids_2, ARRAY[]::UUID[])
                ) AS uid
                WHERE EXISTS (
                    SELECT 1 FROM users u
                    WHERE u.user_id    = uid
                      AND u.school_id  = v_school_id
                      AND u.is_active  = true
                      AND u.deleted_at IS NULL
                      AND u.role_type IN (
                          'GURU', 'BK', 'WALI_KELAS', 'KAPRODI',
                          'WAKA_KESISWAAN', 'WAKA_KURIKULUM', 'WAKA_HUMAS',
                          'KEPSEK', 'TU', 'ADMINISTRATIVE',
                          'SISWA', 'ORTU'
                      )
                )
            ) || ARRAY[v_caller_id];

        -- Tolak jika tidak ada penerima valid selain caller sendiri
        IF array_length(v_audience_ids, 1) <= 1 THEN
            RAISE EXCEPTION 'Tidak ada penerima valid yang ditemukan di sekolah ini.';
        END IF;

        -- INSERT forum_post_audience
        INSERT INTO forum_post_audience (post_id, user_id, school_id)
        SELECT DISTINCT v_post_id, uid, v_school_id
        FROM   unnest(v_audience_ids) uid
        WHERE  uid IS NOT NULL
        ON CONFLICT DO NOTHING;

        -- Kirim notifikasi
        SELECT full_name INTO v_author_name FROM users WHERE user_id = v_caller_id;

        INSERT INTO notifications (
            school_id, recipient_user_id, type, title, body, forum_post_id
        )
        SELECT
            v_school_id,
            fpa.user_id,
            'FORUM_POST_NEW',
            format(
                CASE WHEN v_caller_role = 'ORTU' THEN 'Kabar Ortu: %s' ELSE 'Pengumuman: %s' END,
                v_title
            ),
            format('%s: %s',
                   coalesce(v_author_name, 'Seseorang'),
                   left(trim(p_content), 80)),
            v_post_id
        FROM   forum_post_audience fpa
        WHERE  fpa.post_id  = v_post_id
          AND  fpa.user_id != v_caller_id;

        RETURN v_post_id;

    END IF;

    -- ════════════════════════════════════════════════════════
    -- PATH B: scope_type = 'KELAS' (logika existing, tidak diubah)
    -- ════════════════════════════════════════════════════════

    v_title := COALESCE(p_title, left(trim(p_content), 200));

    -- ── Validasi audience_type ────────────────────────────────
    IF p_audience_type NOT IN (
        'STAF_SAJA','PUBLIK','ORTU_SISWA_KELAS','ORTU_SISWA_SUBJEK','ORANG_TERTENTU'
    ) THEN
        RAISE EXCEPTION 'audience_type tidak valid: %', p_audience_type;
    END IF;

    IF p_audience_type = 'ORTU_SISWA_SUBJEK'
       AND (p_subject_student_ids IS NULL OR array_length(p_subject_student_ids, 1) IS NULL)
    THEN
        RAISE EXCEPTION 'ORTU_SISWA_SUBJEK membutuhkan minimal 1 subjek siswa di p_subject_student_ids.';
    END IF;

    IF p_audience_type = 'ORANG_TERTENTU'
       AND (p_specific_user_ids IS NULL OR array_length(p_specific_user_ids, 1) IS NULL)
    THEN
        RAISE EXCEPTION 'ORANG_TERTENTU membutuhkan minimal 1 user_id di p_specific_user_ids.';
    END IF;

    -- ── Validasi audience_type_2 (opsional) ──────────────────
    IF p_audience_type_2 IS NOT NULL AND p_audience_type_2 NOT IN (
        'STAF_SAJA','PUBLIK','ORTU_SISWA_KELAS','ORTU_SISWA_SUBJEK','ORANG_TERTENTU'
    ) THEN
        RAISE EXCEPTION 'audience_type_2 tidak valid: %', p_audience_type_2;
    END IF;

    IF p_audience_type_2 = 'ORANG_TERTENTU'
       AND (p_specific_user_ids_2 IS NULL OR array_length(p_specific_user_ids_2, 1) IS NULL)
    THEN
        RAISE EXCEPTION 'ORANG_TERTENTU (audience_type_2) membutuhkan minimal 1 user_id di p_specific_user_ids_2.';
    END IF;

    -- ── Validasi: caller harus anggota forum ──────────────────
    IF NOT EXISTS (
        SELECT 1
        FROM   fn_get_forum_members(p_class_id, p_academic_year, 'PARENT_VISIBLE') m
        WHERE  m.user_id = v_caller_id
    ) THEN
        RAISE EXCEPTION 'Akses ditolak: Anda bukan anggota forum kelas ini.';
    END IF;

    -- ── Resolve category_id dari category_code ────────────────
    IF p_category_code IS NOT NULL AND trim(p_category_code) <> '' THEN
        SELECT category_id INTO v_category_id
        FROM   communication_categories
        WHERE  category_code = p_category_code AND is_active = true;
    END IF;

    -- ── Tentukan visibility ───────────────────────────────────
    -- INTERNAL hanya jika KEDUA audience_type adalah STAF_SAJA (atau _2 NULL).
    -- Jika salah satu melibatkan ortu/siswa → PARENT_VISIBLE.
    v_visibility := CASE
        WHEN p_audience_type = 'STAF_SAJA'
             AND (p_audience_type_2 IS NULL OR p_audience_type_2 = 'STAF_SAJA')
        THEN 'INTERNAL'
        ELSE 'PARENT_VISIBLE'
    END;

    -- ── INSERT forum_posts ────────────────────────────────────
    -- FUNC-03: pembungkus unique_violation, sama seperti PATH A.
    BEGIN
        INSERT INTO forum_posts (
            post_id, school_id, class_id, category_id, author_user_id,
            academic_year, title, body, visibility,
            audience_type, audience_type_2, scope_type, idempotency_key
        ) VALUES (
            v_post_id, v_school_id, p_class_id, v_category_id, v_caller_id,
            p_academic_year, v_title, p_content, v_visibility,
            p_audience_type, p_audience_type_2, 'KELAS', p_idempotency_key
        );
    EXCEPTION WHEN unique_violation THEN
        SELECT fp.post_id INTO v_existing_id
        FROM   forum_posts fp
        WHERE  fp.school_id       = v_school_id
          AND  fp.author_user_id  = v_caller_id
          AND  fp.idempotency_key = p_idempotency_key;
        IF v_existing_id IS NOT NULL THEN
            RETURN v_existing_id;
        END IF;
        RAISE;
    END;

    -- ── INSERT forum_post_subjects ────────────────────────────
    IF p_subject_student_ids IS NOT NULL
       AND array_length(p_subject_student_ids, 1) > 0
    THEN
        INSERT INTO forum_post_subjects (post_id, student_id, school_id)
        SELECT v_post_id, sid, v_school_id
        FROM   unnest(p_subject_student_ids) sid
        ON CONFLICT DO NOTHING;
    END IF;

    -- ── Kalkulasi audience dari audience_type ─────────────────

    IF p_audience_type = 'STAF_SAJA' THEN
        SELECT array_agg(DISTINCT m.user_id)
        INTO   v_audience_ids
        FROM   fn_get_forum_members(p_class_id, p_academic_year, 'INTERNAL') m;

    ELSIF p_audience_type = 'PUBLIK' THEN
        SELECT array_agg(DISTINCT uid)
        INTO   v_audience_ids
        FROM (
            SELECT user_id AS uid
            FROM   fn_get_forum_members(p_class_id, p_academic_year, 'PARENT_VISIBLE')
            UNION
            SELECT s.user_id
            FROM   students s
            JOIN   class_enrollments ce ON ce.student_id = s.student_id
            WHERE  ce.class_id      = p_class_id
              AND  ce.academic_year = p_academic_year
              AND  ce.withdrawn_at  IS NULL
              AND  ce.school_id     = v_school_id
              AND  s.user_id        IS NOT NULL
              AND  s.school_id      = v_school_id
        ) sub;

    ELSIF p_audience_type = 'ORTU_SISWA_KELAS' THEN
        SELECT array_agg(DISTINCT uid)
        INTO   v_audience_ids
        FROM (
            SELECT sp.parent_user_id AS uid
            FROM   student_parents sp
            JOIN   class_enrollments ce ON ce.student_id = sp.student_id
            WHERE  ce.class_id      = p_class_id
              AND  ce.academic_year = p_academic_year
              AND  ce.withdrawn_at  IS NULL
              AND  ce.school_id     = v_school_id
              AND  sp.school_id     = v_school_id
            UNION
            SELECT s.user_id
            FROM   students s
            JOIN   class_enrollments ce ON ce.student_id = s.student_id
            WHERE  ce.class_id      = p_class_id
              AND  ce.academic_year = p_academic_year
              AND  ce.withdrawn_at  IS NULL
              AND  ce.school_id     = v_school_id
              AND  s.user_id        IS NOT NULL
              AND  s.school_id      = v_school_id
        ) sub;

    ELSIF p_audience_type = 'ORTU_SISWA_SUBJEK' THEN
        SELECT array_agg(DISTINCT uid)
        INTO   v_audience_ids
        FROM (
            SELECT sp.parent_user_id AS uid
            FROM   student_parents sp
            WHERE  sp.student_id = ANY(p_subject_student_ids)
              AND  sp.school_id  = v_school_id
            UNION
            SELECT s.user_id
            FROM   students s
            WHERE  s.student_id = ANY(p_subject_student_ids)
              AND  s.user_id    IS NOT NULL
              AND  s.school_id  = v_school_id
        ) sub;

    ELSIF p_audience_type = 'ORANG_TERTENTU' THEN
        SELECT array_agg(DISTINCT uid)
        INTO   v_audience_ids
        FROM (
            SELECT u AS uid
            FROM   unnest(p_specific_user_ids) u
            WHERE  u IN (
                SELECT user_id
                FROM   fn_get_forum_members(p_class_id, p_academic_year, 'PARENT_VISIBLE')
                UNION
                SELECT s.user_id
                FROM   students s
                JOIN   class_enrollments ce ON ce.student_id = s.student_id
                WHERE  ce.class_id      = p_class_id
                  AND  ce.academic_year = p_academic_year
                  AND  ce.withdrawn_at  IS NULL
                  AND  ce.school_id     = v_school_id
                  AND  s.user_id        IS NOT NULL
            )
        ) sub;
    END IF;

    -- ── Kalkulasi audience dari audience_type_2 (jika ada) ───

    IF p_audience_type_2 IS NOT NULL THEN

        IF p_audience_type_2 = 'STAF_SAJA' THEN
            SELECT array_agg(DISTINCT m.user_id)
            INTO   v_audience_ids_2
            FROM   fn_get_forum_members(p_class_id, p_academic_year, 'INTERNAL') m;

        ELSIF p_audience_type_2 = 'PUBLIK' THEN
            SELECT array_agg(DISTINCT uid)
            INTO   v_audience_ids_2
            FROM (
                SELECT user_id AS uid
                FROM   fn_get_forum_members(p_class_id, p_academic_year, 'PARENT_VISIBLE')
                UNION
                SELECT s.user_id
                FROM   students s
                JOIN   class_enrollments ce ON ce.student_id = s.student_id
                WHERE  ce.class_id      = p_class_id
                  AND  ce.academic_year = p_academic_year
                  AND  ce.withdrawn_at  IS NULL
                  AND  ce.school_id     = v_school_id
                  AND  s.user_id        IS NOT NULL
                  AND  s.school_id      = v_school_id
            ) sub;

        ELSIF p_audience_type_2 = 'ORTU_SISWA_KELAS' THEN
            SELECT array_agg(DISTINCT uid)
            INTO   v_audience_ids_2
            FROM (
                SELECT sp.parent_user_id AS uid
                FROM   student_parents sp
                JOIN   class_enrollments ce ON ce.student_id = sp.student_id
                WHERE  ce.class_id      = p_class_id
                  AND  ce.academic_year = p_academic_year
                  AND  ce.withdrawn_at  IS NULL
                  AND  ce.school_id     = v_school_id
                  AND  sp.school_id     = v_school_id
                UNION
                SELECT s.user_id
                FROM   students s
                JOIN   class_enrollments ce ON ce.student_id = s.student_id
                WHERE  ce.class_id      = p_class_id
                  AND  ce.academic_year = p_academic_year
                  AND  ce.withdrawn_at  IS NULL
                  AND  ce.school_id     = v_school_id
                  AND  s.user_id        IS NOT NULL
                  AND  s.school_id      = v_school_id
            ) sub;

        ELSIF p_audience_type_2 = 'ORTU_SISWA_SUBJEK' THEN
            SELECT array_agg(DISTINCT uid)
            INTO   v_audience_ids_2
            FROM (
                SELECT sp.parent_user_id AS uid
                FROM   student_parents sp
                WHERE  sp.student_id = ANY(p_subject_student_ids)
                  AND  sp.school_id  = v_school_id
                UNION
                SELECT s.user_id
                FROM   students s
                WHERE  s.student_id = ANY(p_subject_student_ids)
                  AND  s.user_id    IS NOT NULL
                  AND  s.school_id  = v_school_id
            ) sub;

        ELSIF p_audience_type_2 = 'ORANG_TERTENTU' THEN
            SELECT array_agg(DISTINCT uid)
            INTO   v_audience_ids_2
            FROM (
                SELECT u AS uid
                FROM   unnest(p_specific_user_ids_2) u
                WHERE  u IN (
                    SELECT user_id
                    FROM   fn_get_forum_members(p_class_id, p_academic_year, 'PARENT_VISIBLE')
                    UNION
                    SELECT s.user_id
                    FROM   students s
                    JOIN   class_enrollments ce ON ce.student_id = s.student_id
                    WHERE  ce.class_id      = p_class_id
                      AND  ce.academic_year = p_academic_year
                      AND  ce.withdrawn_at  IS NULL
                      AND  ce.school_id     = v_school_id
                      AND  s.user_id        IS NOT NULL
                )
            ) sub;
        END IF;

    END IF;

    -- ── Gabungkan audience dari kedua tipe + selalu sertakan penulis ──
    v_audience_ids :=
        COALESCE(v_audience_ids,   ARRAY[]::UUID[]) ||
        COALESCE(v_audience_ids_2, ARRAY[]::UUID[]) ||
        ARRAY[v_caller_id];

    -- ── INSERT forum_post_audience ────────────────────────────
    INSERT INTO forum_post_audience (post_id, user_id, school_id)
    SELECT DISTINCT v_post_id, uid, v_school_id
    FROM   unnest(v_audience_ids) uid
    WHERE  uid IS NOT NULL
    ON CONFLICT DO NOTHING;

    -- ── Kirim notifikasi FORUM_POST_NEW ───────────────────────
    SELECT full_name INTO v_author_name FROM users   WHERE user_id  = v_caller_id;
    SELECT name       INTO v_class_name  FROM classes WHERE class_id = p_class_id;

    INSERT INTO notifications (
        school_id, recipient_user_id, type, title, body, forum_post_id
    )
    SELECT
        v_school_id,
        fpa.user_id,
        'FORUM_POST_NEW',
        format('Posting baru di %s', coalesce(v_class_name, 'Forum Kelas')),
        format('%s: %s',
               coalesce(v_author_name, 'Seseorang'),
               left(trim(p_content), 80)),
        v_post_id
    FROM   forum_post_audience fpa
    WHERE  fpa.post_id  = v_post_id
      AND  fpa.user_id != v_caller_id;

    RETURN v_post_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_create_placement(p_student_id uuid, p_dudi_user_id uuid, p_start_date date, p_end_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id uuid := public.fn_current_school_id();
    v_student_program_id uuid;
BEGIN
    SELECT s.program_id
      INTO v_student_program_id
      FROM public.students s
     WHERE s.student_id = p_student_id
       AND s.school_id = v_school_id;

    IF v_student_program_id IS NULL
       OR NOT public.fn_can_manage_pkl_student(p_student_id) THEN
        RAISE EXCEPTION 'access_denied: pengguna tidak berwenang mengelola siswa ini';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.users d
        WHERE d.user_id = p_dudi_user_id
          AND d.school_id = v_school_id
          AND d.role_type = 'DUDI'
          AND (
              public.fn_current_user_role() IN ('ADMINISTRATIVE', 'KEPSEK')
              OR EXISTS (
                  SELECT 1
                  FROM public.users manager
                  WHERE manager.auth_user_id = auth.uid()
                    AND manager.is_kepsek
              )
              OR d.program_id = v_student_program_id
          )
    ) THEN
        RAISE EXCEPTION 'domain_invariant_violation: DUDI tidak ditemukan dalam cakupan pengguna';
    END IF;

    INSERT INTO public.pkl_placements (
        school_id, student_id, dudi_user_id, start_date, end_date, is_active
    )
    VALUES (v_school_id, p_student_id, p_dudi_user_id, p_start_date, p_end_date, true);

    UPDATE public.students
       SET student_status = 'PKL'
     WHERE student_id = p_student_id
       AND school_id = v_school_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_current_academic_year(p_school_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT COALESCE(
        (SELECT ap.academic_year
           FROM academic_periods ap
          WHERE ap.school_id = p_school_id
            AND ap.status = 'ACTIVE'
          ORDER BY ap.start_date DESC
          LIMIT 1),
        (SELECT sc.current_academic_year
           FROM school_config sc
          WHERE sc.school_id = p_school_id
          LIMIT 1)
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_current_school_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT u.school_id
    FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.is_active IS TRUE
      AND u.deleted_at IS NULL
    LIMIT 1;
$function$;
CREATE OR REPLACE FUNCTION public.fn_current_student_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT student_id FROM students WHERE user_id = fn_current_user_id();
$function$;
CREATE OR REPLACE FUNCTION public.fn_current_user_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT user_id FROM users WHERE auth_user_id = auth.uid();
$function$;
CREATE OR REPLACE FUNCTION public.fn_current_user_role()
 RETURNS role_type
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT role_type FROM users WHERE auth_user_id = auth.uid();
$function$;
CREATE OR REPLACE FUNCTION public.fn_deactivate_stale_staff()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_count integer;
    v_sid   uuid := fn_current_school_id();
BEGIN
    IF NOT (fn_is_kepsek() OR fn_current_user_role() = 'ADMINISTRATIVE') THEN
        RAISE EXCEPTION 'akses ditolak: hanya admin/kepsek'
            USING ERRCODE = '42501';
    END IF;

    -- Bypass trigger trg_guard_users_protected_columns agar is_active
    -- bisa diubah. Flag LOCAL: reset otomatis akhir transaksi.
    PERFORM set_config('app.bypass_users_guard', 'on', true);

    WITH stale AS (
        SELECT user_id FROM fn_get_stale_staff()
    )
    UPDATE users
       SET is_active = FALSE
     WHERE user_id IN (SELECT user_id FROM stale)
       AND school_id = v_sid;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_delete_forum_post(p_post_id uuid)
 RETURNS TABLE(deleted_post_id uuid, attachment_path text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_caller    uuid := public.fn_current_user_id();
    v_school    uuid := public.fn_current_school_id();
    v_author    uuid;
    v_path      text;
    v_moderator boolean := false;
BEGIN
    IF p_post_id IS NULL THEN
        RAISE EXCEPTION 'post_id wajib diisi.'
            USING ERRCODE = '22004';
    END IF;

    -- Tenant-safe: posting di luar sekolah caller dianggap tidak ada.
    SELECT fp.author_user_id, fp.attachment_path
    INTO   v_author, v_path
    FROM   public.forum_posts fp
    WHERE  fp.post_id   = p_post_id
      AND  fp.school_id = v_school;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Posting tidak ditemukan.'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.user_id    = v_caller
          AND u.school_id  = v_school
          AND u.is_active  = true
          AND u.deleted_at IS NULL
          AND (
              u.role_type IN ('KEPSEK', 'WAKA_KESISWAAN', 'ADMINISTRATIVE')
              OR u.is_kepsek = true
              OR u.is_waka_kesiswaan = true
          )
    ) INTO v_moderator;

    -- v_caller NULL (tidak terautentikasi) selalu jatuh ke cabang tolak:
    -- NULL IS DISTINCT FROM <apapun> bernilai true, dan v_moderator false.
    IF v_caller IS DISTINCT FROM v_author AND NOT v_moderator THEN
        RAISE EXCEPTION 'Akses ditolak: hanya penulis atau moderator yang dapat menghapus posting.'
            USING ERRCODE = '42501';
    END IF;

    -- Notifikasi dibersihkan lebih dulu. FK-nya ON DELETE SET NULL,
    -- jadi tanpa baris ini notifikasinya bertahan sebagai rujukan kosong.
    DELETE FROM public.notifications
    WHERE forum_post_id = p_post_id
      AND school_id     = v_school;

    -- Tabel anak (audience, comments, acknowledgements, subjects)
    -- ikut terhapus lewat ON DELETE CASCADE.
    DELETE FROM public.forum_posts
    WHERE post_id   = p_post_id
      AND school_id = v_school;

    RETURN QUERY SELECT p_post_id, v_path;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_delete_school_coaching_case_events(p_school_id uuid, p_after_event_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 200)
 RETURNS TABLE(deleted integer, last_id uuid, has_more boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_event_ids uuid[];
    v_trigger_disabled boolean := false;
BEGIN
    IF p_limit < 1 OR p_limit > 200 THEN
        RAISE EXCEPTION 'p_limit must be between 1 and 200';
    END IF;

    SELECT array_agg(event_id ORDER BY event_id)
    INTO v_event_ids
    FROM (
        SELECT event_id
        FROM public.coaching_case_events
        WHERE school_id = p_school_id
          AND (p_after_event_id IS NULL OR event_id > p_after_event_id)
        ORDER BY event_id
        LIMIT p_limit
    ) AS picked;

    IF COALESCE(array_length(v_event_ids, 1), 0) = 0 THEN
        RETURN QUERY SELECT 0, p_after_event_id, false;
        RETURN;
    END IF;

    ALTER TABLE public.coaching_case_events
        DISABLE TRIGGER trg_coaching_case_events_immutable;
    v_trigger_disabled := true;

    DELETE FROM public.coaching_case_events
    WHERE event_id = ANY(v_event_ids);

    ALTER TABLE public.coaching_case_events
        ENABLE TRIGGER trg_coaching_case_events_immutable;
    v_trigger_disabled := false;

    RETURN QUERY
    SELECT
        array_length(v_event_ids, 1),
        v_event_ids[array_length(v_event_ids, 1)],
        EXISTS (
            SELECT 1
            FROM public.coaching_case_events
            WHERE school_id = p_school_id
              AND event_id > v_event_ids[array_length(v_event_ids, 1)]
        );
EXCEPTION
    WHEN OTHERS THEN
        IF v_trigger_disabled THEN
            ALTER TABLE public.coaching_case_events
                ENABLE TRIGGER trg_coaching_case_events_immutable;
        END IF;
        RAISE;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_delete_teacher_document(p_doc_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id UUID;
    v_found     BOOLEAN;
BEGIN
    v_school_id := fn_current_school_id();

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'school_id tidak terdeteksi untuk user ini'
            USING ERRCODE = '42501';
    END IF;

    -- Verifikasi dokumen ada, milik caller, di sekolah caller
    SELECT EXISTS (
        SELECT 1 FROM teacher_documents
        WHERE doc_id          = p_doc_id
          AND school_id       = v_school_id
          AND teacher_user_id = auth.uid()
    ) INTO v_found;

    IF NOT v_found THEN
        RAISE EXCEPTION 'Dokumen tidak ditemukan atau tidak ada izin untuk menghapus'
            USING ERRCODE = 'P0002';
    END IF;

    -- Hapus approval terlebih dahulu
    DELETE FROM teacher_document_approvals
    WHERE doc_id = p_doc_id;

    -- Hapus class assignments
    DELETE FROM teacher_document_classes
    WHERE doc_id = p_doc_id;

    -- Hapus dokumen utama dengan guard school_id dan teacher_user_id
    DELETE FROM teacher_documents
    WHERE doc_id          = p_doc_id
      AND school_id       = v_school_id
      AND teacher_user_id = auth.uid();
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_dudi_can_record_attendance(p_placement_id uuid, p_student_id uuid, p_date date)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT public.fn_dudi_owns_placement(p_placement_id, p_student_id)
       AND p_date <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date
       AND EXISTS (
           SELECT 1 FROM public.pkl_placements pp
           WHERE pp.placement_id = p_placement_id AND pp.is_active IS TRUE
             AND p_date BETWEEN pp.start_date AND pp.end_date
       );
$function$;
CREATE OR REPLACE FUNCTION public.fn_dudi_owns_placement(p_placement_id uuid, p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT public.fn_current_user_role() = 'DUDI'
       AND EXISTS (
           SELECT 1 FROM public.pkl_placements pp
           JOIN public.students s ON s.student_id = pp.student_id AND s.school_id = pp.school_id
           WHERE pp.placement_id = p_placement_id AND pp.student_id = p_student_id
             AND pp.school_id = public.fn_current_school_id()
             AND pp.dudi_user_id = public.fn_current_user_id()
       );
$function$;
CREATE OR REPLACE FUNCTION public.fn_dudi_placements()
 RETURNS TABLE(placement_id uuid, student_id uuid, full_name text, nis text, start_date date, end_date date, is_active boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT pp.placement_id, pp.student_id, s.full_name::text, s.nis::text,
           pp.start_date, pp.end_date, pp.is_active
    FROM public.pkl_placements pp
    JOIN public.students s ON s.student_id = pp.student_id AND s.school_id = pp.school_id
    WHERE public.fn_current_user_role() = 'DUDI'
      AND pp.school_id = public.fn_current_school_id()
      AND pp.dudi_user_id = public.fn_current_user_id()
    ORDER BY pp.start_date, pp.placement_id;
$function$;
CREATE OR REPLACE FUNCTION public.fn_dudi_supervises_student(p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT public.fn_student_in_current_school(p_student_id)
       AND EXISTS (
            SELECT 1
            FROM public.pkl_placements pp
            WHERE pp.student_id = p_student_id
              AND pp.school_id = public.fn_current_school_id()
              AND pp.dudi_user_id = public.fn_current_user_id()
              AND pp.is_active = TRUE
       );
$function$;
CREATE OR REPLACE FUNCTION public.fn_evaluate_teacher_indicators(p_session_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(schedule_id uuid, resolved_to teacher_attendance_indicator)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    WITH resolved AS (
        UPDATE teaching_schedules ts
        SET teacher_indicator = CASE
            WHEN EXISTS (
                SELECT 1 FROM teacher_attendance_log tal
                WHERE tal.schedule_id = ts.schedule_id
            ) THEN 'HADIR'::teacher_attendance_indicator
            ELSE 'TIDAK_HADIR'::teacher_attendance_indicator
        END
        WHERE ts.session_date       = p_session_date
          AND ts.teacher_indicator  = 'PENDING_EVALUATION'
          AND ts.meeting_status     = 'NORMAL'
          -- Do not resolve substituted sessions here; substitute signal handled separately
          AND NOT EXISTS (
              SELECT 1 FROM substitute_schedules ss
              WHERE ss.schedule_id = ts.schedule_id
          )
        RETURNING ts.schedule_id, ts.teacher_indicator
    )
    SELECT r.schedule_id, r.teacher_indicator FROM resolved r;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_finalize_reapply_job(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_job    schedule_reapply_jobs%ROWTYPE;
    v_result jsonb;
BEGIN
    -- 1. Lock baris job — FOR UPDATE mencegah concurrent finalize untuk job sama.
    --    Request kedua yang tiba bersamaan akan tunggu di sini, lalu lihat
    --    status sudah berubah (GENERATING/DONE/FAILED) dan ditolak oleh guard di bawah.
    SELECT * INTO v_job
    FROM   schedule_reapply_jobs
    WHERE  job_id = p_job_id
    FOR UPDATE;

    -- 2. Job tidak ditemukan
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', format('Job %s tidak ditemukan', p_job_id)
        );
    END IF;

    -- 3. Guard ketat: HANYA status DELETED yang boleh lanjut.
    --    PENDING/DELETING → batch DELETE belum selesai
    --    GENERATING       → concurrent request sudah masuk duluan
    --    DONE             → sudah selesai, cegah double-finalize
    --    FAILED           → terminal state, butuh intervensi manual
    IF v_job.status <> 'DELETED' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', format(
                'Job %s berstatus %s — finalize hanya bisa dijalankan '
                'setelah semua sesi lama dihapus (status = DELETED)',
                p_job_id, v_job.status
            )
        );
    END IF;

    -- 4. Tandai sedang generate.
    --    Tidak ada commit parsial di sini — UPDATE ini hanya commit kalau
    --    seluruh function selesai normal (RETURN tercapai). Kalau proses mati
    --    sebelum RETURN, seluruh transaksi rollback dan job kembali DELETED.
    UPDATE schedule_reapply_jobs
    SET    status     = 'GENERATING',
           updated_at = NOW()
    WHERE  job_id = p_job_id;

    -- 5. Generate sesi baru dari template — bungkus dalam exception handler.
    --    academic_year, semester, school_id diambil dari baris job (bukan parameter
    --    tambahan) — otorisasi tenant sudah diverifikasi di edge function sebelum
    --    RPC ini dipanggil (job.school_id == user.school_id di TypeScript).
    BEGIN
        SELECT public.fn_apply_schedule_templates(
            v_job.academic_year,
            v_job.semester,
            v_job.school_id
        ) INTO v_result;

        -- Sukses → DONE
        UPDATE schedule_reapply_jobs
        SET    status       = 'DONE',
               completed_at = NOW(),
               updated_at   = NOW()
        WHERE  job_id = p_job_id;

        RETURN jsonb_build_object('success', true, 'result', v_result);

    EXCEPTION WHEN OTHERS THEN
        -- Gagal → FAILED, simpan pesan PostgreSQL asli.
        -- TIDAK RAISE — biarkan transaksi commit dengan status FAILED
        -- supaya UPDATE ini benar-benar persisten di database.
        -- Caller (edge function) WAJIB cek field 'success' di jsonb,
        -- bukan hanya mengandalkan exception dari .rpc() call.
        UPDATE schedule_reapply_jobs
        SET    status        = 'FAILED',
               error_message = SQLERRM,
               updated_at    = NOW()
        WHERE  job_id = p_job_id;

        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
    END;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_finish_placement(p_student_id uuid, p_placement_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id uuid := public.fn_current_school_id();
BEGIN
    IF NOT public.fn_can_manage_pkl_student(p_student_id) THEN
        RAISE EXCEPTION 'access_denied: pengguna tidak berwenang mengelola siswa ini';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.pkl_placements p
        WHERE p.placement_id = p_placement_id
          AND p.student_id = p_student_id
          AND p.school_id = v_school_id
          AND p.is_active = true
    ) THEN
        RAISE EXCEPTION 'domain_invariant_violation: placement aktif tidak ditemukan untuk siswa ini';
    END IF;

    UPDATE public.pkl_placements
       SET is_active = false
     WHERE placement_id = p_placement_id
       AND school_id = v_school_id;

    UPDATE public.students
       SET student_status = 'AKTIF'
     WHERE student_id = p_student_id
       AND school_id = v_school_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_forum_attachment_moderator()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM users u
        WHERE u.user_id = fn_current_user_id() AND u.school_id = fn_current_school_id()
          AND u.is_active IS TRUE AND u.deleted_at IS NULL
          AND (u.role_type IN ('KEPSEK', 'WAKA_KESISWAAN', 'ADMINISTRATIVE')
            OR u.is_kepsek IS TRUE OR u.is_waka_kesiswaan IS TRUE));
$function$;
CREATE OR REPLACE FUNCTION public.fn_forum_attachment_readable(p_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM forum_posts fp
        WHERE fp.school_id = fn_current_school_id() AND fp.attachment_path = p_path
          AND fp.deleted_at IS NULL AND fn_can_read_forum_post(fp.post_id));
$function$;
CREATE OR REPLACE FUNCTION public.fn_get_active_reapply_job(p_academic_year text, p_semester semester)
 RETURNS TABLE(job_id uuid, status text, total_to_delete integer, deleted_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id uuid;
    v_role      role_type;
BEGIN
    v_school_id := fn_current_school_id();
    v_role      := fn_current_user_role();

    IF v_school_id IS NULL OR v_role IS NULL THEN
        RAISE EXCEPTION 'Sesi tidak valid — silakan login ulang';
    END IF;

    IF v_role <> 'ADMINISTRATIVE'::role_type THEN
        RAISE EXCEPTION 'Hanya akun ADMINISTRATIVE yang dapat memeriksa status Terapkan Ulang';
    END IF;

    RETURN QUERY
    SELECT j.job_id, j.status, j.total_to_delete, j.deleted_count
    FROM   schedule_reapply_jobs j
    WHERE  j.school_id     = v_school_id
      AND  j.academic_year = p_academic_year
      AND  j.semester      = p_semester
      AND  j.status IN ('PENDING', 'DELETING', 'DELETED', 'GENERATING')
    LIMIT  1;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_get_all_grades_summary(p_student_id uuid DEFAULT NULL::uuid, p_academic_year character varying DEFAULT NULL::character varying, p_semester integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_student_id uuid;
    v_school_id uuid := fn_current_school_id();
    v_grades jsonb;
BEGIN
    v_student_id := CASE WHEN fn_current_user_role() = 'SISWA' THEN fn_current_student_id() ELSE p_student_id END;
    IF NOT fn_portal_can_read_student(v_student_id)
       OR (p_student_id IS NOT NULL AND p_student_id IS DISTINCT FROM v_student_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Akses tidak diizinkan');
    END IF;
    SELECT COALESCE(jsonb_agg(g.row_data ORDER BY g.academic_year DESC, g.semester DESC, g.subject_name, g.kind, g.id), '[]'::jsonb)
    INTO v_grades FROM (
        SELECT a.academic_year, a.semester, sub.name AS subject_name, 'ASESMEN' AS kind, ar.id,
            jsonb_build_object('grade_summary_id', ar.id, 'subject_id', a.subject_id,
                'subject_name', sub.name, 'academic_year', a.academic_year, 'semester', a.semester,
                'nilai_akhir', ar.nilai, 'predikat', ar.status, 'deskripsi_naratif', ar.umpan_balik,
                'published_at', ar.updated_at, 'kind', 'ASESMEN',
                'label', concat_ws(' - ', a.jenis, a.instrumen, a.tanggal::text)) AS row_data
        FROM assessment_results ar
        JOIN assessments a ON a.id = ar.assessment_id AND a.school_id = ar.school_id AND a.class_id = ar.class_id
        JOIN subjects sub ON sub.subject_id = a.subject_id AND sub.school_id = a.school_id
        WHERE ar.school_id = v_school_id AND ar.student_id = v_student_id
          AND fn_portal_assessment_visible(a.id)
          AND (p_academic_year IS NULL OR a.academic_year = p_academic_year)
          AND (p_semester IS NULL OR a.semester = p_semester)
        UNION ALL
        SELECT gr.academic_year, gr.semester, sub.name, 'REKAP', gr.id,
            jsonb_build_object('grade_summary_id', gr.id, 'subject_id', lo.subject_id,
                'subject_name', sub.name, 'academic_year', gr.academic_year, 'semester', gr.semester,
                'nilai_akhir', gr.nilai_akhir, 'predikat', NULL, 'deskripsi_naratif', gr.deskripsi_capaian,
                'published_at', gr.updated_at, 'kind', 'REKAP', 'label', 'Rekap tersimpan')
        FROM grade_recap gr
        JOIN learning_objectives lo ON lo.id = gr.learning_objective_id AND lo.school_id = gr.school_id
            AND lo.class_id = gr.class_id AND lo.academic_year = gr.academic_year AND lo.semester = gr.semester
        JOIN subjects sub ON sub.subject_id = lo.subject_id AND sub.school_id = lo.school_id
        WHERE gr.school_id = v_school_id AND gr.student_id = v_student_id
          AND fn_portal_recap_visible(lo.id)
          AND (p_academic_year IS NULL OR gr.academic_year = p_academic_year)
          AND (p_semester IS NULL OR gr.semester = p_semester)
    ) g;
    RETURN jsonb_build_object('success', true, 'student_id', v_student_id, 'grades', v_grades);
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_get_cp_for_subject(p_subject_id uuid, p_program_code character varying, p_grade_level smallint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'core'
AS $function$
DECLARE
    v_kode_pattern     VARCHAR;
    v_snm_row          RECORD;
    v_core_subject_id  UUID;
    v_confidence       VARCHAR;
    v_cp_row           RECORD;
    v_phase_id         UUID;
    v_result           JSONB;
    v_elemen           JSONB;
BEGIN
    -- Ambil kode mapel lokal dari public.subjects
    SELECT UPPER(TRIM(code)) INTO v_kode_pattern
    FROM public.subjects
    WHERE subject_id = p_subject_id
      AND is_active = true
    LIMIT 1;

    IF v_kode_pattern IS NULL THEN
        RETURN jsonb_build_object('found', false);
    END IF;

    -- Prioritas 0 (BARU): LIKE pattern — cocok untuk 'DDPK X TJKT', 'DDPK X AKL', dst.
    SELECT core_subject_id, confidence INTO v_snm_row
    FROM core.subject_name_mapping
    WHERE kode_pattern LIKE (v_kode_pattern || ' X %')
      AND program_hint  = p_program_code
      AND grade_level   = p_grade_level
      AND is_active     = true
    ORDER BY confidence DESC
    LIMIT 1;

    -- Prioritas 1: exact kode+program+grade
    IF v_snm_row IS NULL THEN
        SELECT core_subject_id, confidence INTO v_snm_row
        FROM core.subject_name_mapping
        WHERE kode_pattern = v_kode_pattern
          AND program_hint  = p_program_code
          AND grade_level   = p_grade_level
          AND is_active     = true
        LIMIT 1;
    END IF;

    -- Prioritas 2: kode+program, grade NULL
    IF v_snm_row IS NULL THEN
        SELECT core_subject_id, confidence INTO v_snm_row
        FROM core.subject_name_mapping
        WHERE kode_pattern = v_kode_pattern
          AND program_hint  = p_program_code
          AND grade_level   IS NULL
          AND is_active     = true
        LIMIT 1;
    END IF;

    -- Prioritas 3: kode saja, program NULL, grade NULL
    IF v_snm_row IS NULL THEN
        SELECT core_subject_id, confidence INTO v_snm_row
        FROM core.subject_name_mapping
        WHERE kode_pattern = v_kode_pattern
          AND program_hint  IS NULL
          AND grade_level   IS NULL
          AND is_active     = true
        LIMIT 1;
    END IF;

    IF v_snm_row IS NULL THEN
        RETURN jsonb_build_object('found', false);
    END IF;

    v_core_subject_id := v_snm_row.core_subject_id;
    v_confidence      := v_snm_row.confidence;

    -- Tentukan phase_id dari grade_level
    SELECT phase_id INTO v_phase_id
    FROM core.phases
    WHERE (p_grade_level = 10 AND code = 'E')
       OR (p_grade_level IN (11, 12) AND code = 'F')
    LIMIT 1;

    IF v_phase_id IS NULL THEN
        SELECT phase_id INTO v_phase_id
        FROM core.phases
        ORDER BY code DESC
        LIMIT 1;
    END IF;

    -- Ambil CP via subject_phases → capaian_pembelajaran
    SELECT cp.cp_id, cp.cp_umum, cp.bskap_ref,
           cs.code AS core_subject_code, cs.name AS core_subject_name
    INTO v_cp_row
    FROM core.subject_phases sp
    JOIN core.capaian_pembelajaran cp ON cp.subject_phase_id = sp.subject_phase_id
    JOIN core.subjects cs              ON cs.subject_id      = sp.subject_id
    WHERE sp.subject_id = v_core_subject_id
      AND sp.phase_id   = v_phase_id
      AND cp.is_active  = true
    ORDER BY cp.display_order NULLS LAST
    LIMIT 1;

    IF v_cp_row IS NULL THEN
        RETURN jsonb_build_object('found', false);
    END IF;

    -- Ambil semua elemen CP
    SELECT jsonb_agg(
        jsonb_build_object(
            'element_id',    e.element_id,
            'element_order', e.element_order,
            'nama_elemen',   e.nama_elemen,
            'deskripsi_cp',  e.deskripsi_cp
        ) ORDER BY e.element_order
    ) INTO v_elemen
    FROM core.cp_elements e
    WHERE e.cp_id     = v_cp_row.cp_id
      AND e.is_active = true;

    v_result := jsonb_build_object(
        'found',              true,
        'confidence',         v_confidence,
        'core_subject_code',  v_cp_row.core_subject_code,
        'core_subject_name',  v_cp_row.core_subject_name,
        'cp_umum',            v_cp_row.cp_umum,
        'bskap_ref',          v_cp_row.bskap_ref,
        'elemen',             COALESCE(v_elemen, '[]'::JSONB)
    );

    RETURN v_result;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_get_escalation_candidates(p_case_id uuid)
 RETURNS TABLE(user_id uuid, full_name text, role_type role_type, relation_label text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_student_id         UUID;
    v_track              case_track;
    v_current_handler    UUID;
    v_school_id          UUID;
    v_student_program_id UUID;
    v_student_class_id   UUID;
    v_academic_year      VARCHAR(9);
    v_semester           semester;
BEGIN
    -- Validasi: caller harus bisa lihat kasus ini
    IF NOT fn_can_see_coaching_case(p_case_id) THEN
        RAISE EXCEPTION 'permission_denied: tidak dapat melihat kasus ini'
            USING ERRCODE = 'P0001';
    END IF;

    -- Ambil metadata kasus
    SELECT c.student_id, c.track, c.current_handler_user_id, c.school_id
    INTO   v_student_id, v_track, v_current_handler, v_school_id
    FROM   coaching_cases c
    WHERE  c.case_id = p_case_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found: kasus tidak ditemukan. case_id=%', p_case_id
            USING ERRCODE = 'P0004';
    END IF;

    -- Ambil program studi siswa
    SELECT s.program_id
    INTO   v_student_program_id
    FROM   students s
    WHERE  s.student_id = v_student_id;

    -- Ambil tahun ajaran dan semester berjalan (dari school_config tenant ini)
    -- Bisa NULL jika school belum konfigurasi — semua lookup yang butuh nilai ini
    -- sudah dilindungi oleh guard IS NOT NULL di level WHERE clause.
    SELECT sc.current_academic_year, sc.current_semester
    INTO   v_academic_year, v_semester
    FROM   school_config sc
    WHERE  sc.school_id = v_school_id
    LIMIT  1;

    -- Ambil kelas aktif siswa pada semester berjalan
    -- NULL jika siswa PKL dan tidak punya enrollment aktif, atau school_config belum diset.
    SELECT ce.class_id
    INTO   v_student_class_id
    FROM   class_enrollments ce
    WHERE  ce.student_id    = v_student_id
      AND  ce.academic_year = v_academic_year
      AND  ce.semester      = v_semester
      AND  ce.withdrawn_at  IS NULL
    LIMIT  1;

    -- ─────────────────────────────────────────────────────────────────────────
    IF v_track = 'SEKOLAH' THEN

        RETURN QUERY
        WITH candidates AS (

            -- 1. Wali Kelas (homeroom teacher untuk kelas siswa)
            SELECT u.user_id,
                   u.full_name::TEXT,
                   u.role_type,
                   'Wali Kelas'::TEXT AS relation_label,
                   1                  AS priority
            FROM   users u
            WHERE  u.school_id           = v_school_id
              AND  u.is_active           = TRUE
              AND  u.wali_kelas_class_id = v_student_class_id
              AND  v_student_class_id    IS NOT NULL

            UNION ALL

            -- 2. Guru Wali (guru yang ditugaskan sebagai wali personal siswa ini)
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Guru Wali'::TEXT, 2
            FROM   guru_wali_assignments gwa
            JOIN   users u ON u.user_id = gwa.guru_user_id
            WHERE  gwa.student_id    = v_student_id
              AND  gwa.academic_year = v_academic_year
              AND  gwa.is_active     = TRUE
              AND  gwa.school_id     = v_school_id
              AND  u.is_active       = TRUE
              AND  v_academic_year   IS NOT NULL

            UNION ALL

            -- 3. Kaprodi program studi siswa
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Kaprodi'::TEXT, 3
            FROM   users u
            WHERE  u.school_id          = v_school_id
              AND  u.is_active          = TRUE
              AND  u.kaprodi_program_id = v_student_program_id
              AND  v_student_program_id IS NOT NULL

            UNION ALL

            -- 4. Guru BK yang ditugaskan untuk kelas siswa ini
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Guru BK'::TEXT, 4
            FROM   bk_class_assignments bca
            JOIN   users u ON u.user_id = bca.bk_user_id
            WHERE  bca.class_id      = v_student_class_id
              AND  bca.academic_year = v_academic_year
              AND  bca.is_active     = TRUE
              AND  bca.school_id     = v_school_id
              AND  u.is_active       = TRUE
              AND  v_student_class_id IS NOT NULL
              AND  v_academic_year    IS NOT NULL

            UNION ALL

            -- 5. Guru Mapel yang mengajar kelas siswa semester berjalan
            SELECT DISTINCT
                   u.user_id, u.full_name::TEXT, u.role_type,
                   'Guru Mapel'::TEXT, 5
            FROM   teaching_assignments ta
            JOIN   users u ON u.user_id = ta.user_id
            WHERE  ta.class_id      = v_student_class_id
              AND  ta.academic_year = v_academic_year
              AND  ta.semester      = v_semester
              AND  ta.is_active     = TRUE
              AND  u.school_id      = v_school_id
              AND  u.is_active      = TRUE
              AND  v_student_class_id IS NOT NULL

            UNION ALL

            -- 6. Waka Kesiswaan
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Waka Kesiswaan'::TEXT, 6
            FROM   users u
            WHERE  u.school_id         = v_school_id
              AND  u.is_active         = TRUE
              AND  u.is_waka_kesiswaan = TRUE

            UNION ALL

            -- 7. Kepsek
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Kepala Sekolah'::TEXT, 7
            FROM   users u
            WHERE  u.school_id = v_school_id
              AND  u.is_active = TRUE
              AND  u.is_kepsek = TRUE

        ),
        -- Deduplikat: satu baris per user, ambil relation_label dengan priority terkecil
        deduped AS (
            SELECT DISTINCT ON (c.user_id)
                c.user_id, c.full_name, c.role_type, c.relation_label
            FROM candidates c
            ORDER BY c.user_id, c.priority
        )
        SELECT d.user_id, d.full_name, d.role_type, d.relation_label
        FROM   deduped d
        -- Exclude handler aktif — tidak bisa eskalasi ke diri sendiri
        WHERE  d.user_id != v_current_handler
        ORDER  BY d.relation_label, d.full_name;

    -- ─────────────────────────────────────────────────────────────────────────
    ELSIF v_track = 'PKL' THEN

        RETURN QUERY
        WITH candidates AS (

            -- 1. DUDI Supervisor (penempatan PKL aktif siswa)
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'DUDI Supervisor'::TEXT AS relation_label,
                   1                       AS priority
            FROM   pkl_placements pp
            JOIN   users u ON u.user_id = pp.dudi_user_id
            WHERE  pp.student_id = v_student_id
              AND  pp.is_active  = TRUE
              AND  u.school_id   = v_school_id
              AND  u.is_active   = TRUE

            UNION ALL

            -- 2. Guru Pembimbing PKL (guru internal pendamping PKL)
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Guru Pembimbing PKL'::TEXT, 2
            FROM   pkl_placements pp
            JOIN   users u ON u.user_id = pp.guru_pembimbing_user_id
            WHERE  pp.student_id              = v_student_id
              AND  pp.is_active               = TRUE
              AND  u.school_id                = v_school_id
              AND  u.is_active                = TRUE
              AND  pp.guru_pembimbing_user_id IS NOT NULL

            UNION ALL

            -- 3. Wali Kelas (dari kelas asal siswa, sebelum/selama PKL)
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Wali Kelas'::TEXT, 3
            FROM   users u
            WHERE  u.school_id           = v_school_id
              AND  u.is_active           = TRUE
              AND  u.wali_kelas_class_id = v_student_class_id
              AND  v_student_class_id    IS NOT NULL

            UNION ALL

            -- 4. Guru Wali (guru yang ditugaskan sebagai wali personal siswa ini)
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Guru Wali'::TEXT, 4
            FROM   guru_wali_assignments gwa
            JOIN   users u ON u.user_id = gwa.guru_user_id
            WHERE  gwa.student_id    = v_student_id
              AND  gwa.academic_year = v_academic_year
              AND  gwa.is_active     = TRUE
              AND  gwa.school_id     = v_school_id
              AND  u.is_active       = TRUE
              AND  v_academic_year   IS NOT NULL

            UNION ALL

            -- 5. Kaprodi program studi siswa
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Kaprodi'::TEXT, 5
            FROM   users u
            WHERE  u.school_id          = v_school_id
              AND  u.is_active          = TRUE
              AND  u.kaprodi_program_id = v_student_program_id
              AND  v_student_program_id IS NOT NULL

            UNION ALL

            -- 6. Guru BK yang ditugaskan untuk kelas asal siswa
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Guru BK'::TEXT, 6
            FROM   bk_class_assignments bca
            JOIN   users u ON u.user_id = bca.bk_user_id
            WHERE  bca.class_id      = v_student_class_id
              AND  bca.academic_year = v_academic_year
              AND  bca.is_active     = TRUE
              AND  bca.school_id     = v_school_id
              AND  u.is_active       = TRUE
              AND  v_student_class_id IS NOT NULL
              AND  v_academic_year    IS NOT NULL

            UNION ALL

            -- 7. Waka Humas (koordinator PKL di level sekolah)
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Waka Humas'::TEXT, 7
            FROM   users u
            WHERE  u.school_id     = v_school_id
              AND  u.is_active     = TRUE
              AND  u.is_waka_humas = TRUE

            UNION ALL

            -- 8. Kepsek
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Kepala Sekolah'::TEXT, 8
            FROM   users u
            WHERE  u.school_id = v_school_id
              AND  u.is_active = TRUE
              AND  u.is_kepsek = TRUE

        ),
        deduped AS (
            SELECT DISTINCT ON (c.user_id)
                c.user_id, c.full_name, c.role_type, c.relation_label
            FROM candidates c
            ORDER BY c.user_id, c.priority
        )
        SELECT d.user_id, d.full_name, d.role_type, d.relation_label
        FROM   deduped d
        WHERE  d.user_id != v_current_handler
        ORDER  BY d.relation_label, d.full_name;

    END IF;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_get_forum_bk_staff()
 RETURNS TABLE(user_id uuid, full_name text, role_type text, login_identifier text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT u.user_id, u.full_name::text, u.role_type::text, u.login_identifier::text
    FROM public.users u
    WHERE u.school_id = public.fn_current_school_id()
      AND u.is_active IS TRUE
      AND u.deleted_at IS NULL
      AND (u.role_type = 'BK' OR u.is_bk IS TRUE)
      AND u.role_type NOT IN ('SISWA', 'ORTU', 'DUDI', 'STAKEHOLDER')
      AND EXISTS (
          SELECT 1 FROM public.users caller
          WHERE caller.auth_user_id = auth.uid()
            AND caller.school_id = u.school_id
            AND caller.role_type = 'ADMINISTRATIVE'
            AND caller.is_active IS TRUE
            AND caller.deleted_at IS NULL
      )
    ORDER BY u.full_name;
$function$;
CREATE OR REPLACE FUNCTION public.fn_get_forum_member_details(p_class_id uuid, p_academic_year text)
 RETURNS TABLE(user_id uuid, full_name text, role_type text, student_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id uuid;
    v_program_id uuid;
    v_caller_school_id uuid := public.fn_current_school_id();
BEGIN
    SELECT c.school_id, c.program_id INTO v_school_id, v_program_id
    FROM public.classes c WHERE c.class_id = p_class_id;
    IF v_caller_school_id IS NULL OR v_school_id IS DISTINCT FROM v_caller_school_id THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text, NULL::text
    FROM public.users u
    WHERE u.wali_kelas_class_id = p_class_id
      AND u.school_id = v_school_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
      AND u.role_type NOT IN ('DUDI', 'SISWA', 'STAKEHOLDER')
    UNION
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text, NULL::text
    FROM public.teaching_assignments ta JOIN public.users u ON u.user_id = ta.user_id
    WHERE ta.class_id = p_class_id AND ta.academic_year = p_academic_year
      AND ta.is_active IS TRUE AND ta.school_id = v_school_id
      AND u.school_id = v_school_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
      AND u.role_type NOT IN ('DUDI', 'SISWA', 'STAKEHOLDER')
    UNION
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text, NULL::text
    FROM public.guru_wali_assignments gwa JOIN public.users u ON u.user_id = gwa.guru_user_id
    WHERE gwa.academic_year = p_academic_year AND gwa.is_active IS TRUE
      AND gwa.school_id = v_school_id
      AND u.school_id = v_school_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
      AND u.role_type NOT IN ('DUDI', 'SISWA', 'STAKEHOLDER')
      AND gwa.student_id IN (
          SELECT ce.student_id FROM public.class_enrollments ce
          WHERE ce.class_id = p_class_id AND ce.academic_year = p_academic_year
            AND ce.withdrawn_at IS NULL AND ce.school_id = v_school_id
      )
    UNION
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text, NULL::text
    FROM public.bk_class_assignments bca JOIN public.users u ON u.user_id = bca.bk_user_id
    WHERE bca.class_id = p_class_id AND bca.academic_year = p_academic_year
      AND bca.is_active IS TRUE AND bca.school_id = v_school_id
      AND u.school_id = v_school_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
      AND u.role_type NOT IN ('DUDI', 'SISWA', 'STAKEHOLDER')
    UNION
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text, NULL::text
    FROM public.users u
    WHERE u.school_id = v_school_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
      AND u.role_type NOT IN ('DUDI', 'SISWA', 'STAKEHOLDER')
      AND (u.role_type IN ('WAKA_KESISWAAN', 'KEPSEK', 'ADMINISTRATIVE')
           OR u.is_waka_kesiswaan IS TRUE OR u.is_kepsek IS TRUE)
    UNION
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text, NULL::text
    FROM public.users u
    WHERE u.school_id = v_school_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
      AND v_program_id IS NOT NULL
      AND u.role_type NOT IN ('DUDI', 'SISWA', 'STAKEHOLDER')
      AND (u.program_id = v_program_id OR u.kaprodi_program_id = v_program_id)
    UNION
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text, s.full_name::text
    FROM public.student_parents sp
    JOIN public.students s ON s.student_id = sp.student_id
    JOIN public.class_enrollments ce ON ce.student_id = s.student_id
    JOIN public.users u ON u.user_id = sp.parent_user_id
    WHERE ce.class_id = p_class_id AND ce.academic_year = p_academic_year
      AND ce.withdrawn_at IS NULL AND ce.school_id = v_school_id
      AND sp.school_id = v_school_id AND s.school_id = v_school_id
      AND s.student_status = 'AKTIF'
      AND u.school_id = v_school_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
    ORDER BY full_name;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_get_forum_members(p_class_id uuid, p_academic_year text, p_visibility text DEFAULT 'INTERNAL'::text)
 RETURNS TABLE(user_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id  UUID;
    v_program_id UUID;
BEGIN
    SELECT c.school_id, c.program_id
    INTO   v_school_id, v_program_id
    FROM   classes c
    WHERE  c.class_id = p_class_id;

    -- GUARD TENANT (fix audit Codex #1, 2 Okt 2026): v_school_id diambil dari
    -- p_class_id, BUKAN dari pemanggil. Tanpa guard ini, pengguna sekolah A bisa
    -- memanggil dengan class_id sekolah B dan menerima daftar user_id anggotanya.
    -- Pemanggil sah selalu menyusun forum untuk kelas sekolahnya sendiri, jadi
    -- guard ini tidak memblokir alur normal.
    IF v_school_id IS NULL OR v_school_id <> fn_current_school_id() THEN
        RETURN;
    END IF;

    RETURN QUERY

    -- 1. Wali Kelas
    SELECT DISTINCT u.user_id
    FROM   users u
    WHERE  u.wali_kelas_class_id = p_class_id
      AND  u.school_id            = v_school_id
      AND  u.is_active            = true
      AND  u.deleted_at           IS NULL

    UNION

    -- 2. Guru Mapel yang mengajar kelas ini
    SELECT DISTINCT ta.user_id
    FROM   teaching_assignments ta
    WHERE  ta.class_id      = p_class_id
      AND  ta.academic_year = p_academic_year
      AND  ta.is_active     = true
      AND  ta.school_id     = v_school_id

    UNION

    -- 3. Guru Wali yang menangani siswa aktif di kelas ini
    SELECT DISTINCT gwa.guru_user_id
    FROM   guru_wali_assignments gwa
    WHERE  gwa.academic_year = p_academic_year
      AND  gwa.is_active     = true
      AND  gwa.school_id     = v_school_id
      AND  gwa.student_id IN (
               SELECT ce.student_id
               FROM   class_enrollments ce
               WHERE  ce.class_id      = p_class_id
                 AND  ce.academic_year = p_academic_year
                 AND  ce.withdrawn_at  IS NULL
                 AND  ce.school_id     = v_school_id
           )

    UNION

    -- 4. BK yang ditugaskan ke kelas ini
    SELECT DISTINCT bca.bk_user_id
    FROM   bk_class_assignments bca
    WHERE  bca.class_id      = p_class_id
      AND  bca.academic_year = p_academic_year
      AND  bca.is_active     = true
      AND  bca.school_id     = v_school_id

    UNION

    -- 5. Waka Kesiswaan dan Kepsek (seluruh sekolah)
    --    role_type ATAU jabatan tambahan (multi-role)
    SELECT DISTINCT u.user_id
    FROM   users u
    WHERE  u.school_id  = v_school_id
      AND  u.is_active  = true
      AND  u.deleted_at IS NULL
      AND  (
               u.role_type IN ('WAKA_KESISWAAN', 'KEPSEK', 'ADMINISTRATIVE')
               OR u.is_waka_kesiswaan = true
               OR u.is_kepsek        = true
           )

    UNION

    -- 6. Kaprodi yang mengelola program kelas ini
    --    program_id (primary) ATAU kaprodi_program_id (jabatan tambahan)
    SELECT DISTINCT u.user_id
    FROM   users u
    WHERE  u.school_id  = v_school_id
      AND  u.is_active  = true
      AND  u.deleted_at IS NULL
      AND  v_program_id IS NOT NULL
      AND  (
               u.program_id        = v_program_id
               OR u.kaprodi_program_id = v_program_id
           )

    UNION

    -- 7. Ortu siswa aktif di kelas (hanya jika PARENT_VISIBLE)
    SELECT DISTINCT sp.parent_user_id
    FROM   student_parents sp
    JOIN   class_enrollments ce ON ce.student_id = sp.student_id
    WHERE  p_visibility       = 'PARENT_VISIBLE'
      AND  ce.class_id        = p_class_id
      AND  ce.academic_year   = p_academic_year
      AND  ce.withdrawn_at    IS NULL
      AND  ce.school_id       = v_school_id
      AND  sp.school_id       = v_school_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_get_forum_recipient_candidates(p_target_group text, p_program_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid, p_day_of_week smallint DEFAULT NULL::smallint, p_academic_year text DEFAULT NULL::text)
 RETURNS TABLE(user_id uuid, full_name text, role_label text, extra_info text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_school_id  uuid        := fn_current_school_id();
  v_acad_year  text        := COALESCE(p_academic_year,
    to_char(now(), 'YYYY') || '/' || to_char(now() + interval '1 year', 'YYYY'));
  v_day_enum   day_of_week;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.school_id = v_school_id
      AND u.is_active IS TRUE AND u.deleted_at IS NULL
      AND u.role_type IN (
        'GURU', 'BK', 'WALI_KELAS', 'KAPRODI',
        'WAKA_KESISWAAN', 'WAKA_KURIKULUM', 'WAKA_HUMAS',
        'KEPSEK', 'TU', 'ADMINISTRATIVE'
      )
  ) THEN
    RAISE EXCEPTION 'Akses kandidat penerima forum hanya untuk staf aktif.'
      USING ERRCODE = '42501';
  END IF;

  IF p_day_of_week IS NOT NULL THEN
    v_day_enum := CASE p_day_of_week
      WHEN 1 THEN 'SENIN'
      WHEN 2 THEN 'SELASA'
      WHEN 3 THEN 'RABU'
      WHEN 4 THEN 'KAMIS'
      WHEN 5 THEN 'JUMAT'
      WHEN 6 THEN 'SABTU'
    END::day_of_week;
  END IF;

  IF p_target_group = 'SEMUA_GURU' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'GURU'::text, NULL::text
      FROM public.users u
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND u.role_type = 'GURU';

  ELSIF p_target_group = 'GURU_MAPEL' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'GURU'::text, NULL::text
      FROM public.users u
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND u.role_type = 'GURU'
        AND (p_program_id IS NULL OR u.program_id = p_program_id);

  ELSIF p_target_group = 'SEMUA_GURU_WALI' THEN
    RETURN QUERY
      SELECT DISTINCT u.user_id, u.full_name::text, 'GURU_WALI'::text, NULL::text
      FROM public.users u
      JOIN public.guru_wali_assignments gwa ON gwa.guru_user_id = u.user_id
      WHERE u.school_id     = v_school_id
        AND u.is_active     = true AND u.deleted_at IS NULL
        AND gwa.school_id   = v_school_id
        AND gwa.is_active   = true
        AND gwa.academic_year = v_acad_year;

  ELSIF p_target_group = 'SEMUA_WALI_KELAS' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'WALI_KELAS'::text, c.name::text
      FROM public.users u
      JOIN public.classes c ON c.class_id = u.wali_kelas_class_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND u.wali_kelas_class_id IS NOT NULL
        AND c.is_active = true;

  ELSIF p_target_group = 'WALI_KELAS_JURUSAN' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'WALI_KELAS'::text, c.name::text
      FROM public.users u
      JOIN public.classes c ON c.class_id = u.wali_kelas_class_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND u.wali_kelas_class_id IS NOT NULL
        AND c.program_id = p_program_id
        AND c.is_active = true;

  ELSIF p_target_group = 'SEMUA_KAPRODI' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'KAPRODI'::text, pr.name::text
      FROM public.users u
      JOIN public.programs pr ON pr.program_id = u.kaprodi_program_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND u.kaprodi_program_id IS NOT NULL;

  ELSIF p_target_group = 'KAPRODI_JURUSAN' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'KAPRODI'::text, pr.name::text
      FROM public.users u
      JOIN public.programs pr ON pr.program_id = u.kaprodi_program_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND u.kaprodi_program_id = p_program_id;

  ELSIF p_target_group = 'SEMUA_BK' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'BK'::text, NULL::text
      FROM public.users u
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND u.is_bk = true;

  ELSIF p_target_group = 'SEMUA_WAKA' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text,
             CASE
               WHEN u.is_waka_kurikulum THEN 'WAKA_KURIKULUM'
               WHEN u.is_waka_kesiswaan THEN 'WAKA_KESISWAAN'
               WHEN u.is_waka_humas     THEN 'WAKA_HUMAS'
               ELSE u.role_type
             END::text,
             NULL::text
      FROM public.users u
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND (u.is_waka_kurikulum = true OR u.is_waka_kesiswaan = true
          OR u.is_waka_humas = true
          OR u.role_type IN ('WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS'));

  ELSIF p_target_group = 'KEPSEK' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'KEPSEK'::text, NULL::text
      FROM public.users u
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND (u.is_kepsek = true OR u.role_type = 'KEPSEK');

  ELSIF p_target_group = 'SEMUA_TU' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'TU'::text, NULL::text
      FROM public.users u
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND u.role_type IN ('TU','ADMINISTRATIVE');

  ELSIF p_target_group = 'SEMUA_SISWA' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'SISWA'::text, NULL::text
      FROM public.users u
      JOIN public.students s ON s.user_id = u.user_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND s.student_status = 'AKTIF';

  -- SISWA_KELAS & SISWA_PER_KELAS: siswa dalam kelas tertentu
  ELSIF p_target_group IN ('SISWA_KELAS', 'SISWA_PER_KELAS') THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'SISWA'::text, c.name::text
      FROM public.users u
      JOIN public.students s ON s.user_id = u.user_id
      JOIN public.class_enrollments ce ON ce.student_id = s.student_id
      JOIN public.classes c ON c.class_id = ce.class_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND s.student_status = 'AKTIF'
        AND ce.class_id = p_class_id
        AND ce.academic_year = v_acad_year
        AND ce.withdrawn_at IS NULL;

  -- SISWA_JURUSAN & SISWA_PER_JURUSAN: siswa dalam program/jurusan tertentu
  ELSIF p_target_group IN ('SISWA_JURUSAN', 'SISWA_PER_JURUSAN') THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'SISWA'::text, pr.name::text
      FROM public.users u
      JOIN public.students s ON s.user_id = u.user_id
      JOIN public.programs pr ON pr.program_id = s.program_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND s.student_status = 'AKTIF'
        AND s.program_id = p_program_id;

  ELSIF p_target_group = 'SEMUA_ORTU' THEN
    RETURN QUERY
      SELECT DISTINCT u.user_id, u.full_name::text, 'ORTU'::text, NULL::text
      FROM public.users u
      JOIN public.student_parents sp ON sp.parent_user_id = u.user_id
      JOIN public.students s ON s.student_id = sp.student_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND s.student_status = 'AKTIF'
        AND sp.school_id = v_school_id;

  -- ORTU_KELAS & ORTU_PER_KELAS: ortu siswa dalam kelas tertentu
  ELSIF p_target_group IN ('ORTU_KELAS', 'ORTU_PER_KELAS') THEN
    RETURN QUERY
      SELECT DISTINCT u.user_id, u.full_name::text, 'ORTU'::text, c.name::text
      FROM public.users u
      JOIN public.student_parents sp ON sp.parent_user_id = u.user_id
      JOIN public.students s ON s.student_id = sp.student_id
      JOIN public.class_enrollments ce ON ce.student_id = s.student_id
      JOIN public.classes c ON c.class_id = ce.class_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND s.student_status = 'AKTIF'
        AND ce.class_id = p_class_id
        AND ce.academic_year = v_acad_year
        AND ce.withdrawn_at IS NULL
        AND sp.school_id = v_school_id;

  -- ORTU_JURUSAN & ORTU_PER_JURUSAN: ortu siswa dalam program/jurusan tertentu
  ELSIF p_target_group IN ('ORTU_JURUSAN', 'ORTU_PER_JURUSAN') THEN
    RETURN QUERY
      SELECT DISTINCT u.user_id, u.full_name::text, 'ORTU'::text, pr.name::text
      FROM public.users u
      JOIN public.student_parents sp ON sp.parent_user_id = u.user_id
      JOIN public.students s ON s.student_id = sp.student_id
      JOIN public.programs pr ON pr.program_id = s.program_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND s.student_status = 'AKTIF'
        AND s.program_id = p_program_id
        AND sp.school_id = v_school_id;

  ELSIF p_target_group = 'GURU_PIKET' THEN
    RETURN QUERY
      SELECT DISTINCT u.user_id, u.full_name::text, 'GURU_PIKET'::text,
             ds.day_of_week::text
      FROM public.users u
      JOIN public.duty_schedules ds ON ds.user_id = u.user_id
      WHERE u.school_id    = v_school_id
        AND u.is_active    = true AND u.deleted_at IS NULL
        AND ds.school_id   = v_school_id
        AND ds.academic_year = v_acad_year
        AND ds.is_active   = true
        AND (v_day_enum IS NULL OR ds.day_of_week = v_day_enum);

  END IF;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_get_stale_staff()
 RETURNS TABLE(user_id uuid, full_name text, login_identifier text, teacher_code text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT (fn_is_kepsek() OR fn_current_user_role() = 'ADMINISTRATIVE') THEN
        RAISE EXCEPTION 'akses ditolak: hanya admin/kepsek'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT u.user_id, u.full_name::text, u.login_identifier::text, u.teacher_code::text
    FROM   users u
    JOIN   school_config sc ON sc.school_id = fn_current_school_id()
    WHERE  u.school_id   = fn_current_school_id()
    AND    u.is_active   = TRUE
    AND    u.role_type   = 'GURU'
    AND    u.is_kepsek          IS NOT TRUE
    AND    u.is_bk              IS NOT TRUE
    AND    u.is_waka_kurikulum  IS NOT TRUE
    AND    u.is_waka_kesiswaan  IS NOT TRUE
    AND    u.is_waka_humas      IS NOT TRUE
    AND    u.wali_kelas_class_id IS NULL
    AND    u.kaprodi_program_id  IS NULL
    AND NOT EXISTS (
        SELECT 1 FROM teaching_assignments ta
        WHERE  ta.user_id       = u.user_id
        AND    ta.school_id     = fn_current_school_id()
        AND    ta.academic_year = sc.current_academic_year
    )
    ORDER BY u.full_name;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_get_user_forum_scope(p_user_id uuid)
 RETURNS TABLE(wali_kelas_class_id uuid, role_type text, program_id uuid, kaprodi_program_id uuid, is_waka_kesiswaan boolean, is_kepsek boolean, is_waka_kurikulum boolean, is_waka_humas boolean, is_bk boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT
        wali_kelas_class_id,
        role_type,
        program_id,
        kaprodi_program_id,
        is_waka_kesiswaan,
        is_kepsek,
        is_waka_kurikulum,
        is_waka_humas,
        is_bk
    FROM public.users
    WHERE user_id  = p_user_id
      AND school_id = fn_current_school_id()
    LIMIT 1;
$function$;
CREATE OR REPLACE FUNCTION public.fn_get_wali_kelas_user_id(p_class_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_caller_user_id uuid;
    v_result         uuid;
BEGIN
    -- Resolve auth.uid() → users.user_id di tenant yang sama
    SELECT user_id INTO v_caller_user_id
    FROM public.users
    WHERE auth_user_id = auth.uid()
      AND school_id = fn_current_school_id()
      AND role_type = 'ORTU'
      AND deleted_at IS NULL
    LIMIT 1;

    -- Guard: caller wajib ORTU di tenant yang sama
    IF v_caller_user_id IS NULL THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    -- Guard: p_class_id wajib terkait dengan anak ORTU pemanggil
    -- Bandingkan dengan user_id (bukan auth.uid()) — ini fix utamanya
    IF NOT EXISTS (
        SELECT 1
        FROM public.student_parents sp
        JOIN public.class_enrollments ce
          ON ce.student_id = sp.student_id
        WHERE sp.parent_user_id = v_caller_user_id
          AND sp.school_id = fn_current_school_id()
          AND ce.class_id = p_class_id
          AND ce.withdrawn_at IS NULL
    ) THEN
        RAISE EXCEPTION 'class not linked to parent'
        USING ERRCODE = '42501';
    END IF;

    -- Ambil wali kelas
    SELECT u.user_id INTO v_result
    FROM public.users u
    WHERE u.school_id = fn_current_school_id()
      AND u.wali_kelas_class_id = p_class_id
      AND u.is_active = true
      AND u.deleted_at IS NULL
    LIMIT 1;

    RETURN v_result;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_guard_forum_assignment_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id uuid;
BEGIN
    -- Allow revoking legacy bad references, but never their reactivation.
    IF TG_OP = 'UPDATE' THEN
        IF NEW.is_active IS FALSE
           AND (to_jsonb(NEW) - 'is_active') = (to_jsonb(OLD) - 'is_active') THEN
            RETURN NEW;
        END IF;
    END IF;

    CASE TG_TABLE_NAME
        WHEN 'bk_class_assignments' THEN
            v_user_id := NEW.bk_user_id;
            IF NOT EXISTS (
                SELECT 1 FROM public.classes c
                WHERE c.class_id = NEW.class_id AND c.school_id = NEW.school_id
            ) THEN
                RAISE EXCEPTION 'Kelas penugasan harus berada di sekolah yang sama.' USING ERRCODE = '23514';
            END IF;
        WHEN 'guru_wali_assignments' THEN
            v_user_id := NEW.guru_user_id;
            IF NOT EXISTS (
                SELECT 1 FROM public.students s
                WHERE s.student_id = NEW.student_id AND s.school_id = NEW.school_id
            ) THEN
                RAISE EXCEPTION 'Siswa penugasan harus berada di sekolah yang sama.' USING ERRCODE = '23514';
            END IF;
        WHEN 'duty_schedules' THEN
            v_user_id := NEW.user_id;
        ELSE
            RAISE EXCEPTION 'Tabel penugasan tidak didukung.' USING ERRCODE = '23514';
    END CASE;

    IF NOT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.user_id = v_user_id AND u.school_id = NEW.school_id
    ) THEN
        RAISE EXCEPTION 'Staf penugasan harus berada di sekolah yang sama.' USING ERRCODE = '23514';
    END IF;
    IF NEW.assigned_by_user_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.user_id = NEW.assigned_by_user_id AND u.school_id = NEW.school_id
    ) THEN
        RAISE EXCEPTION 'Pemberi penugasan harus berada di sekolah yang sama.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_guard_teacher_doc_status_transition()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Bypass untuk postgres, service_role, dan semua context non-authenticated
    -- (termasuk SECURITY DEFINER functions seperti fn_waka_approve_doc yang
    --  jalan sebagai postgres, dan edge function via service_role).
    IF current_user NOT IN ('authenticated', 'anon') THEN
        RETURN NEW;
    END IF;

    -- Whitelist transisi status yang valid untuk role 'authenticated'.
    -- Jika status tidak berubah (update field lain saja), WHEN clause di
    -- CREATE TRIGGER sudah menjamin trigger tidak terpanggil.
    IF (OLD.status = 'AI_DRAFT'      AND NEW.status = 'DIREVIEW_GURU')  OR
       (OLD.status = 'DIREVIEW_GURU' AND NEW.status = 'AI_DRAFT')       OR
       (OLD.status = 'DIREVIEW_GURU' AND NEW.status = 'MENUNGGU_WAKA')  THEN
        RETURN NEW;
    END IF;

    -- Semua transisi lain diblokir
    RAISE EXCEPTION 'forbidden_status_transition: % → % tidak diizinkan untuk role ini',
        OLD.status, NEW.status
        USING ERRCODE = 'P0001';
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_guard_tp_assessment_update()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.assessment_id         <> OLD.assessment_id
    OR NEW.school_id             <> OLD.school_id
    OR NEW.learning_objective_id <> OLD.learning_objective_id
    OR NEW.student_id            <> OLD.student_id
    OR NEW.teacher_user_id       <> OLD.teacher_user_id
    OR NEW.class_id              <> OLD.class_id
    OR NEW.tipe                  <> OLD.tipe
    OR (NEW.judul            IS DISTINCT FROM OLD.judul)
    OR (NEW.nilai_angka      IS DISTINCT FROM OLD.nilai_angka)
    OR (NEW.nilai_kualitatif IS DISTINCT FROM OLD.nilai_kualitatif)
    OR NEW.tanggal               <> OLD.tanggal
    OR NEW.created_at            <> OLD.created_at
    THEN
        RAISE EXCEPTION
            'UPDATE tp_assessments: hanya kolom is_void dan void_reason yang boleh diubah';
    END IF;
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_guard_users_protected_columns()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    old_j        jsonb;
    new_j        jsonb;
    allowed_keys text[] := ARRAY['last_seen_at', 'last_seen_ua', 'updated_at'];
    k            text;
BEGIN
    -- Bypass 1: service_role (semua edge function via getAdminClient()).
    -- PostgREST switch current_user ke 'service_role' saat request memakai
    -- service_role key — sama dengan mekanisme RLS bypass yang sudah ada.
    IF current_user = 'service_role' THEN
        RETURN NEW;
    END IF;

    -- Bypass 2: admin portal kelola user lain. Baris yang boleh disentuh
    -- sudah dijaga oleh rls_users_write_administrative.
    IF fn_current_user_role() = 'ADMINISTRATIVE' THEN
        RETURN NEW;
    END IF;

    -- Bypass 3: jalur resmi ganti password via fn_confirm_password_changed()
    -- SECURITY DEFINER. Flag di-set LOCAL — reset otomatis akhir transaksi.
    IF current_setting('app.bypass_users_guard', true) = 'on' THEN
        RETURN NEW;
    END IF;

    -- Default-deny: bandingkan OLD vs NEW setelah strip kolom yang diizinkan.
    -- Jika ada perbedaan di kolom lain, tolak.
    old_j := to_jsonb(OLD);
    new_j := to_jsonb(NEW);
    FOREACH k IN ARRAY allowed_keys LOOP
        old_j := old_j - k;
        new_j := new_j - k;
    END LOOP;

    IF old_j IS DISTINCT FROM new_j THEN
        RAISE EXCEPTION 'Perubahan kolom ini tidak diizinkan lewat update langsung. Hubungi admin sekolah.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_guru_supervises_pkl_student(p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.pkl_placements pp
        WHERE pp.student_id = p_student_id
          AND pp.school_id = public.fn_current_school_id()
          AND pp.guru_pembimbing_user_id = public.fn_current_user_id()
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_guru_teaches_student(p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM teaching_schedules ts
        JOIN class_enrollments  ce
          ON ce.class_id      = ts.class_id
         AND ce.academic_year  = ts.academic_year
        WHERE ts.scheduled_teacher_id = fn_current_user_id()
          AND ts.school_id            = fn_current_school_id()
          AND ce.student_id      = p_student_id
          AND ce.withdrawn_at   IS NULL
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_has_teaching_schedule(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM teaching_schedules
    WHERE scheduled_teacher_id = p_user_id
      AND school_id = fn_current_school_id()
  );
$function$;
CREATE OR REPLACE FUNCTION public.fn_is_bk()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM users u
        WHERE u.auth_user_id = auth.uid()
          AND (u.role_type = 'BK' OR u.is_bk)
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_is_kepsek()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.auth_user_id = auth.uid()
          AND u.is_active IS TRUE
          AND u.deleted_at IS NULL
          AND (u.role_type = 'KEPSEK'::role_type OR u.is_kepsek IS TRUE)
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_is_observation_subject_or_parent(p_observation_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM observations o
        JOIN students s ON s.student_id = o.student_id
        WHERE o.observation_id = p_observation_id
          AND o.school_id      = fn_current_school_id()
          AND (
              s.user_id = p_user_id
              OR EXISTS (
                  SELECT 1 FROM student_parents sp
                  WHERE sp.student_id    = s.student_id
                    AND sp.parent_user_id = p_user_id
              )
          )
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_is_on_duty_today()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.duty_schedules ds
        JOIN public.school_config sc
          ON sc.school_id = ds.school_id
        WHERE ds.user_id = public.fn_current_user_id()
          AND ds.school_id = public.fn_current_school_id()
          AND ds.academic_year = sc.current_academic_year
          AND ds.semester::text = sc.current_semester::text
          AND ds.day_of_week = CASE
              WHEN EXTRACT(ISODOW FROM NOW() AT TIME ZONE 'Asia/Jakarta')::int = 1 THEN 'SENIN'::public.day_of_week
              WHEN EXTRACT(ISODOW FROM NOW() AT TIME ZONE 'Asia/Jakarta')::int = 2 THEN 'SELASA'::public.day_of_week
              WHEN EXTRACT(ISODOW FROM NOW() AT TIME ZONE 'Asia/Jakarta')::int = 3 THEN 'RABU'::public.day_of_week
              WHEN EXTRACT(ISODOW FROM NOW() AT TIME ZONE 'Asia/Jakarta')::int = 4 THEN 'KAMIS'::public.day_of_week
              WHEN EXTRACT(ISODOW FROM NOW() AT TIME ZONE 'Asia/Jakarta')::int = 5 THEN 'JUMAT'::public.day_of_week
              WHEN EXTRACT(ISODOW FROM NOW() AT TIME ZONE 'Asia/Jakarta')::int = 6 THEN 'SABTU'::public.day_of_week
              ELSE NULL::public.day_of_week
          END
          AND ds.is_active IS TRUE
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_is_parent_of_student(p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.student_parents sp
        WHERE sp.student_id = p_student_id
          AND sp.parent_user_id = public.fn_current_user_id()
          AND sp.school_id = public.fn_current_school_id()
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_is_period_closed(p_date date, p_school_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM academic_periods
        WHERE school_id   = p_school_id
          AND start_date <= p_date
          AND end_date   >= p_date
          AND status      = 'CLOSED'
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_is_schoolwide_observer()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM users u
        WHERE u.auth_user_id = auth.uid()
          AND ( u.role_type IN ('BK','KEPSEK','WAKA_KURIKULUM','WAKA_KESISWAAN')
                OR u.is_bk OR u.is_kepsek OR u.is_waka_kurikulum OR u.is_waka_kesiswaan )
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_is_tu()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.auth_user_id = auth.uid()
          AND u.role_type = 'TU'::public.role_type
          AND u.is_active IS TRUE AND u.deleted_at IS NULL
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_is_waka_humas()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.auth_user_id = auth.uid()
          AND u.is_active IS TRUE
          AND u.deleted_at IS NULL
          AND (u.role_type = 'WAKA_HUMAS' OR u.is_waka_humas)
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_is_waka_kesiswaan()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM users u
        WHERE u.auth_user_id = auth.uid()
          AND (u.role_type = 'WAKA_KESISWAAN' OR u.is_waka_kesiswaan)
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_is_waka_kurikulum()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM users u
        WHERE u.auth_user_id = auth.uid()
          AND (u.role_type = 'WAKA_KURIKULUM' OR u.is_waka_kurikulum)
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_kaprodi_of_student(p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT public.fn_student_in_current_school(p_student_id)
       AND public.fn_kaprodi_program_id() IS NOT NULL
       AND EXISTS (
            SELECT 1
            FROM public.students s
            WHERE s.student_id = p_student_id
              AND s.school_id = public.fn_current_school_id()
              AND s.program_id = public.fn_kaprodi_program_id()
       );
$function$;
CREATE OR REPLACE FUNCTION public.fn_kaprodi_program_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT COALESCE(kaprodi_program_id,
                    CASE WHEN role_type = 'KAPRODI' THEN program_id END)
    FROM users WHERE auth_user_id = auth.uid();
$function$;
CREATE OR REPLACE FUNCTION public.fn_kepsek_monitoring(p_period text DEFAULT 'hari_ini'::text, p_academic_year text DEFAULT NULL::text, p_date_start date DEFAULT NULL::date, p_date_end date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_today       date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
    v_school_id   uuid;
    v_boleh_lihat boolean;
    v_date_start  date;
    v_date_end    date;
    v_by_month    boolean := FALSE;
    v_ay_year     int;
    v_summary     jsonb;
    v_chart       jsonb;
BEGIN
    SELECT school_id,
           (is_active IS TRUE AND deleted_at IS NULL
            AND (role_type IN ('KEPSEK', 'STAKEHOLDER') OR COALESCE(is_kepsek, FALSE)))
    INTO v_school_id, v_boleh_lihat
    FROM users
    WHERE auth_user_id = auth.uid()
    LIMIT 1;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'User tidak ditemukan atau tidak memiliki school_id';
    END IF;
    IF NOT v_boleh_lihat THEN
        RAISE EXCEPTION 'Akses ditolak: monitoring ini hanya untuk Kepala Sekolah dan Stakeholder';
    END IF;

    CASE p_period
        WHEN 'hari_ini' THEN
            v_date_start := v_today;
            v_date_end   := v_today;
        WHEN '7_hari' THEN
            v_date_start := v_today - 6;
            v_date_end   := v_today;
        WHEN 'minggu_lalu' THEN
            v_date_start := date_trunc('week', v_today - 7)::date;
            v_date_end   := date_trunc('week', v_today)::date - 1;
        WHEN 'bulan_lalu' THEN
            v_date_start := date_trunc('month', v_today - interval '1 month')::date;
            v_date_end   := date_trunc('month', v_today)::date - 1;
        WHEN 'tahun_ajaran_lalu' THEN
            IF p_academic_year IS NULL THEN
                RAISE EXCEPTION 'p_academic_year wajib diisi untuk periode tahun_ajaran_lalu';
            END IF;
            v_ay_year    := split_part(p_academic_year, '/', 1)::int;
            v_date_start := make_date(v_ay_year, 7, 1);
            v_date_end   := make_date(v_ay_year + 1, 6, 30);
            v_by_month   := TRUE;
        WHEN 'rentang' THEN
            IF p_date_start IS NULL OR p_date_end IS NULL THEN
                RAISE EXCEPTION 'p_date_start dan p_date_end wajib diisi untuk periode rentang';
            END IF;
            IF p_date_start > p_date_end THEN
                RAISE EXCEPTION 'p_date_start tidak boleh setelah p_date_end' USING ERRCODE = '22007';
            END IF;
            v_date_start := p_date_start;
            v_date_end   := p_date_end;
            v_by_month   := (p_date_end - p_date_start) > 60;
        ELSE
            v_date_start := v_today;
            v_date_end   := v_today;
    END CASE;

    SELECT jsonb_build_object(
        'pct_siswa',
            (SELECT CASE WHEN COUNT(DISTINCT s.student_id) > 0
                THEN round(100.0 *
                    COUNT(DISTINCT CASE WHEN a.status = 'HADIR' AND NOT a.is_void
                          AND ts2.session_date BETWEEN v_date_start AND v_date_end
                          THEN a.student_id END) /
                    COUNT(DISTINCT s.student_id), 1)
                ELSE NULL END
             FROM students s
             LEFT JOIN attendance a ON a.student_id = s.student_id
             LEFT JOIN teaching_schedules ts2
               ON ts2.schedule_id = a.schedule_id
              AND ts2.meeting_status = 'NORMAL'
              AND ts2.school_id = v_school_id
             WHERE s.school_id = v_school_id
               AND s.student_status IN ('AKTIF', 'PKL')),
        'pct_guru',
            (SELECT CASE WHEN COUNT(DISTINCT ts3.scheduled_teacher_id) > 0
                THEN round(100.0 *
                    COUNT(DISTINCT CASE WHEN EXISTS (
                        SELECT 1 FROM attendance ax
                        WHERE ax.schedule_id = ts3.schedule_id AND NOT ax.is_void
                    ) THEN ts3.scheduled_teacher_id END) /
                    COUNT(DISTINCT ts3.scheduled_teacher_id), 1)
                ELSE NULL END
             FROM teaching_schedules ts3
             WHERE ts3.session_date BETWEEN v_date_start AND v_date_end
               AND ts3.school_id = v_school_id
               AND ts3.meeting_status = 'NORMAL'),
        'siswa_hadir',
            (SELECT COUNT(DISTINCT CASE WHEN a.status = 'HADIR' AND NOT a.is_void
                          AND ts2.session_date BETWEEN v_date_start AND v_date_end
                          THEN a.student_id END)
             FROM students s
             LEFT JOIN attendance a ON a.student_id = s.student_id
             LEFT JOIN teaching_schedules ts2
               ON ts2.schedule_id = a.schedule_id
              AND ts2.meeting_status = 'NORMAL'
              AND ts2.school_id = v_school_id
             WHERE s.school_id = v_school_id
               AND s.student_status IN ('AKTIF', 'PKL')),
        'siswa_total',
            (SELECT COUNT(DISTINCT s.student_id)
             FROM students s
             WHERE s.school_id = v_school_id
               AND s.student_status IN ('AKTIF', 'PKL')),
        'guru_hadir',
            (SELECT COUNT(DISTINCT CASE WHEN EXISTS (
                        SELECT 1 FROM attendance ax
                        WHERE ax.schedule_id = ts3.schedule_id AND NOT ax.is_void
                    ) THEN ts3.scheduled_teacher_id END)
             FROM teaching_schedules ts3
             WHERE ts3.session_date BETWEEN v_date_start AND v_date_end
               AND ts3.school_id = v_school_id
               AND ts3.meeting_status = 'NORMAL'),
        'guru_total',
            (SELECT COUNT(DISTINCT ts3.scheduled_teacher_id)
             FROM teaching_schedules ts3
             WHERE ts3.session_date BETWEEN v_date_start AND v_date_end
               AND ts3.school_id = v_school_id
               AND ts3.meeting_status = 'NORMAL'),
        'count_late',
            (SELECT COUNT(*) FROM late_arrivals la
             WHERE la.school_id = v_school_id
               AND la.late_date BETWEEN v_date_start AND v_date_end),
        'count_exits',
            (SELECT COUNT(*) FROM student_exits se
             WHERE se.school_id = v_school_id
               AND se.exit_date BETWEEN v_date_start AND v_date_end)
    ) INTO v_summary;

    IF v_by_month THEN
        WITH v_siswa_aktif AS MATERIALIZED (
            SELECT COUNT(DISTINCT student_id) AS total
            FROM students
            WHERE school_id = v_school_id
              AND student_status IN ('AKTIF', 'PKL')
        )
        SELECT COALESCE(jsonb_agg(pt ORDER BY pt->>'date'), '[]'::jsonb)
        INTO v_chart
        FROM (
            SELECT jsonb_build_object(
                'date', to_char(b.bulan, 'YYYY-MM-01'),
                'pct_siswa', CASE WHEN (SELECT total FROM v_siswa_aktif) > 0
                    THEN round(100.0 * (
                        SELECT COUNT(DISTINCT s2.student_id)
                        FROM students s2
                        JOIN attendance a2 ON a2.student_id = s2.student_id
                        JOIN teaching_schedules ts_inner
                          ON ts_inner.schedule_id = a2.schedule_id
                         AND ts_inner.meeting_status = 'NORMAL'
                         AND ts_inner.school_id = v_school_id
                        WHERE s2.school_id = v_school_id
                          AND s2.student_status IN ('AKTIF', 'PKL')
                          AND a2.status = 'HADIR'
                          AND NOT a2.is_void
                          AND ts_inner.session_date BETWEEN v_date_start AND v_date_end
                          AND date_trunc('month', ts_inner.session_date) = b.bulan
                    ) / (SELECT total FROM v_siswa_aktif), 1)
                    ELSE NULL END,
                'pct_guru', (
                    SELECT CASE WHEN COUNT(DISTINCT ts2.scheduled_teacher_id) > 0
                        THEN round(100.0 *
                            COUNT(DISTINCT CASE WHEN EXISTS (
                                SELECT 1 FROM attendance ax
                                WHERE ax.schedule_id = ts2.schedule_id AND NOT ax.is_void
                            ) THEN ts2.scheduled_teacher_id END) /
                            COUNT(DISTINCT ts2.scheduled_teacher_id), 1)
                        ELSE NULL END
                    FROM teaching_schedules ts2
                    WHERE ts2.session_date BETWEEN v_date_start AND v_date_end
                      AND date_trunc('month', ts2.session_date) = b.bulan
                      AND ts2.school_id = v_school_id
                      AND ts2.meeting_status = 'NORMAL'
                ),
                'count_late', (
                    SELECT COUNT(*) FROM late_arrivals la
                    WHERE la.school_id = v_school_id
                      AND la.late_date BETWEEN v_date_start AND v_date_end
                      AND date_trunc('month', la.late_date) = b.bulan
                ),
                'count_exits', (
                    SELECT COUNT(*) FROM student_exits se
                    WHERE se.school_id = v_school_id
                      AND se.exit_date BETWEEN v_date_start AND v_date_end
                      AND date_trunc('month', se.exit_date) = b.bulan
                )
            ) AS pt
            FROM (
                SELECT date_trunc('month', ts.session_date)::date AS bulan
                FROM teaching_schedules ts
                WHERE ts.session_date BETWEEN v_date_start AND v_date_end
                  AND ts.school_id = v_school_id
                  AND ts.meeting_status = 'NORMAL'
                GROUP BY 1
            ) b
        ) sub;
    ELSE
        WITH v_siswa_aktif AS MATERIALIZED (
            SELECT COUNT(DISTINCT student_id) AS total
            FROM students
            WHERE school_id = v_school_id
              AND student_status IN ('AKTIF', 'PKL')
        )
        SELECT COALESCE(jsonb_agg(pt ORDER BY pt->>'date'), '[]'::jsonb)
        INTO v_chart
        FROM (
            SELECT jsonb_build_object(
                'date', ts.session_date::text,
                'pct_siswa', CASE WHEN (SELECT total FROM v_siswa_aktif) > 0
                    THEN round(100.0 * (
                        SELECT COUNT(DISTINCT s2.student_id)
                        FROM students s2
                        JOIN attendance a2 ON a2.student_id = s2.student_id
                        JOIN teaching_schedules ts_inner
                          ON ts_inner.schedule_id = a2.schedule_id
                         AND ts_inner.meeting_status = 'NORMAL'
                         AND ts_inner.school_id = v_school_id
                        WHERE s2.school_id = v_school_id
                          AND s2.student_status IN ('AKTIF', 'PKL')
                          AND a2.status = 'HADIR'
                          AND NOT a2.is_void
                          AND ts_inner.session_date = ts.session_date
                    ) / (SELECT total FROM v_siswa_aktif), 1)
                    ELSE NULL END,
                'pct_guru', (
                    SELECT CASE WHEN COUNT(DISTINCT ts2.scheduled_teacher_id) > 0
                        THEN round(100.0 *
                            COUNT(DISTINCT CASE WHEN EXISTS (
                                SELECT 1 FROM attendance ax
                                WHERE ax.schedule_id = ts2.schedule_id AND NOT ax.is_void
                            ) THEN ts2.scheduled_teacher_id END) /
                            COUNT(DISTINCT ts2.scheduled_teacher_id), 1)
                        ELSE NULL END
                    FROM teaching_schedules ts2
                    WHERE ts2.session_date = ts.session_date
                      AND ts2.school_id = v_school_id
                      AND ts2.meeting_status = 'NORMAL'
                ),
                'count_late', (
                    SELECT COUNT(*) FROM late_arrivals la
                    WHERE la.school_id = v_school_id
                      AND la.late_date = ts.session_date
                ),
                'count_exits', (
                    SELECT COUNT(*) FROM student_exits se
                    WHERE se.school_id = v_school_id
                      AND se.exit_date = ts.session_date
                )
            ) AS pt
            FROM teaching_schedules ts
            WHERE ts.session_date BETWEEN v_date_start AND v_date_end
              AND ts.school_id = v_school_id
              AND ts.meeting_status = 'NORMAL'
            GROUP BY ts.session_date
        ) sub;
    END IF;

    RETURN jsonb_build_object(
        'period', p_period,
        'date_start', v_date_start,
        'date_end', v_date_end,
        'by_month', v_by_month,
        'summary', v_summary,
        'chart', v_chart,
        'data_earliest', (
            SELECT MIN(ts.session_date)
            FROM teaching_schedules ts
            WHERE ts.school_id = v_school_id
              AND ts.meeting_status = 'NORMAL'
        )
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_ld_doc_in_caller_school(p_document_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM ld_documents d
        WHERE d.document_id = p_document_id
          AND d.school_id   = fn_current_school_id()
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_ld_doc_owned_by_caller(p_document_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM ld_documents d
        WHERE d.document_id = p_document_id
          AND d.created_by  = auth.uid()
          AND d.school_id   = fn_current_school_id()
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_maintenance_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT jsonb_build_object(
        'active',  COALESCE(maintenance_active, FALSE),
        'message', maintenance_message
    )
    FROM platform_config WHERE id = 1;
$function$;
CREATE OR REPLACE FUNCTION public.fn_matches_case_handler(p_handler_role role_type, p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT fn_current_user_role() = p_handler_role
        OR (p_handler_role = 'BK'::role_type             AND fn_is_bk())
        OR (p_handler_role = 'KEPSEK'::role_type         AND fn_is_kepsek())
        OR (p_handler_role = 'WAKA_KESISWAAN'::role_type AND fn_is_waka_kesiswaan())
        OR (p_handler_role = 'WAKA_KURIKULUM'::role_type AND fn_is_waka_kurikulum())
        OR (p_handler_role = 'WAKA_HUMAS'::role_type     AND fn_is_waka_humas())
        OR (p_handler_role = 'KAPRODI'::role_type        AND fn_kaprodi_of_student(p_student_id))
        OR (p_handler_role = 'WALI_KELAS'::role_type     AND fn_wali_of_student(p_student_id));
$function$;
CREATE OR REPLACE FUNCTION public.fn_notify_on_case_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_student_user_id UUID;
    v_author_name     TEXT;
BEGIN
    IF NEW.audience <> 'RESTRICTED' THEN
        RETURN NEW;
    END IF;

    SELECT full_name INTO v_author_name
    FROM   users WHERE user_id = NEW.created_by_user_id;

    SELECT user_id INTO v_student_user_id
    FROM   students WHERE student_id = NEW.student_id;

    IF v_student_user_id IS NOT NULL
       AND v_student_user_id <> NEW.created_by_user_id THEN
        INSERT INTO notifications
            (school_id, recipient_user_id, case_id, type, title, body)
        VALUES (
            NEW.school_id, v_student_user_id, NEW.case_id,
            'CASE_RESTRICTED_NEW',
            'Kasus baru tentang Anda',
            format('%s membuat kasus baru: "%s"',
                   coalesce(v_author_name, 'Guru'), NEW.title)
        );
    END IF;

    INSERT INTO notifications
        (school_id, recipient_user_id, case_id, type, title, body)
    SELECT
        NEW.school_id, sp.parent_user_id, NEW.case_id,
        'CASE_RESTRICTED_NEW',
        'Kasus baru tentang anak Anda',
        format('%s membuat kasus tentang anak Anda: "%s"',
               coalesce(v_author_name, 'Guru'), NEW.title)
    FROM   student_parents sp
    WHERE  sp.student_id     = NEW.student_id
      AND  sp.parent_user_id <> NEW.created_by_user_id;

    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_notify_on_case_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_case            cases%ROWTYPE;
    v_actor_name      TEXT;
    v_title           TEXT;
    v_body            TEXT;
    v_student_user_id UUID;
BEGIN
    IF NEW.event_type NOT IN (
        'DECISION_ESCALATE','COMMENT_ADDED','DECISION_CLOSE','STATUS_CHANGED'
    ) THEN
        RETURN NEW;
    END IF;

    SELECT * INTO v_case FROM cases WHERE case_id = NEW.case_id;
    SELECT full_name INTO v_actor_name FROM users WHERE user_id = NEW.author_user_id;

    -- ── A. Eskalasi → handler baru (tidak berubah) ────────────
    IF NEW.event_type = 'DECISION_ESCALATE'
       AND NEW.new_handler_role IS NOT NULL THEN
        v_title := 'Kasus diteruskan ke Anda';
        v_body  := format('%s meneruskan kasus "%s" kepada Anda.',
                          coalesce(v_actor_name,'Seseorang'), v_case.title);
        INSERT INTO notifications
            (school_id, recipient_user_id, case_id, type, title, body)
        SELECT v_case.school_id, u.user_id, v_case.case_id,
               'ESCALATION_DM', v_title, v_body
        FROM   users u
        WHERE  u.school_id  = v_case.school_id
          AND  u.role_type  = NEW.new_handler_role
          AND  u.is_active  = true
          AND  u.deleted_at IS NULL;
    END IF;

    -- ── B. Siaran internal → kasus PUBLIC (tidak berubah) ─────
    IF v_case.audience = 'PUBLIC'
       AND NEW.event_type IN (
           'COMMENT_ADDED','DECISION_ESCALATE','DECISION_CLOSE','STATUS_CHANGED'
       )
    THEN
        v_title := CASE NEW.event_type
            WHEN 'COMMENT_ADDED'     THEN 'Komentar baru di kasus'
            WHEN 'DECISION_ESCALATE' THEN 'Kasus diteruskan ke handler baru'
            WHEN 'DECISION_CLOSE'    THEN 'Kasus ditutup'
            WHEN 'STATUS_CHANGED'    THEN 'Status kasus berubah'
            ELSE                          'Update kasus'
        END;
        v_body  := format('%s — kasus "%s"',
                          coalesce(v_actor_name,'Seseorang'), v_case.title);
        INSERT INTO notifications
            (school_id, recipient_user_id, case_id, type, title, body)
        SELECT v_case.school_id, u.user_id, v_case.case_id,
               'CASE_BROADCAST', v_title, v_body
        FROM   users u
        WHERE  u.school_id = v_case.school_id
          AND  u.role_type IN (
              'GURU','BK','WALI_KELAS','KAPRODI','WAKA_KESISWAAN','KEPSEK'
          )
          AND  u.is_active  = true
          AND  u.deleted_at IS NULL
          AND  u.user_id   != NEW.author_user_id;
    END IF;

    -- ── C. Update STUDENT_VISIBLE / penutupan → SISWA + ORTU ─
    IF v_case.audience = 'RESTRICTED'
       AND (
           (NEW.event_type = 'COMMENT_ADDED'
            AND NEW.privacy_level = 'STUDENT_VISIBLE')
           OR NEW.event_type = 'DECISION_CLOSE'
       )
    THEN
        SELECT user_id INTO v_student_user_id
        FROM   students WHERE student_id = v_case.student_id;

        v_title := CASE NEW.event_type
            WHEN 'DECISION_CLOSE' THEN 'Kasus Anda ditutup'
            ELSE                       'Komentar baru di kasus Anda'
        END;
        v_body := CASE NEW.event_type
            WHEN 'DECISION_CLOSE'
                THEN format('Kasus "%s" telah ditutup.', v_case.title)
            ELSE format('%s menambahkan komentar pada kasus "%s".',
                        coalesce(v_actor_name,'Guru'), v_case.title)
        END;

        IF v_student_user_id IS NOT NULL
           AND v_student_user_id <> NEW.author_user_id THEN
            INSERT INTO notifications
                (school_id, recipient_user_id, case_id, type, title, body)
            VALUES (
                v_case.school_id, v_student_user_id, v_case.case_id,
                'CASE_STUDENT_UPDATE', v_title, v_body
            );
        END IF;

        INSERT INTO notifications
            (school_id, recipient_user_id, case_id, type, title, body)
        SELECT
            v_case.school_id, sp.parent_user_id, v_case.case_id,
            'CASE_STUDENT_UPDATE',
            replace(v_title, 'Anda', 'anak Anda'),
            v_body
        FROM   student_parents sp
        WHERE  sp.student_id     = v_case.student_id
          AND  sp.parent_user_id <> NEW.author_user_id;
    END IF;

    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_notify_on_exit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_student_name TEXT;
    v_class_id     UUID;
    v_title_ortu   TEXT;
    v_body_ortu    TEXT;
    v_title_guru   TEXT;
    v_body_guru    TEXT;
BEGIN
    SELECT u.full_name INTO v_student_name
    FROM students s JOIN users u ON u.user_id = s.user_id
    WHERE s.student_id = NEW.student_id;

    SELECT ce.class_id INTO v_class_id
    FROM class_enrollments ce
    WHERE ce.student_id = NEW.student_id AND ce.withdrawn_at IS NULL
    ORDER BY ce.academic_year DESC, ce.semester DESC LIMIT 1;

    v_title_ortu := 'Anak Anda izin keluar sekolah';
    v_body_ortu  := format('%s izin keluar pada %s pukul %s.%s',
        coalesce(v_student_name,'Siswa'),
        to_char(NEW.exit_date,'DD Mon YYYY'),
        to_char(NEW.exit_time,'HH24:MI'),
        CASE WHEN NEW.reason IS NOT NULL THEN ' Alasan: ' || NEW.reason ELSE '' END);

    v_title_guru := 'Siswa izin keluar dari kelas Anda';
    v_body_guru  := format('%s izin keluar pada %s pukul %s.',
        coalesce(v_student_name,'Siswa'),
        to_char(NEW.exit_date,'DD Mon YYYY'),
        to_char(NEW.exit_time,'HH24:MI'));

    INSERT INTO notifications(school_id, recipient_user_id, type, title, body)
    SELECT NEW.school_id, sp.parent_user_id, 'EXIT_NOTIFICATION', v_title_ortu, v_body_ortu
    FROM student_parents sp
    WHERE sp.student_id = NEW.student_id AND sp.school_id = NEW.school_id;

    IF v_class_id IS NOT NULL THEN
        INSERT INTO notifications(school_id, recipient_user_id, type, title, body)
        SELECT DISTINCT ON (ts.scheduled_teacher_id)
            NEW.school_id, ts.scheduled_teacher_id, 'EXIT_NOTIFICATION', v_title_guru, v_body_guru
        FROM teaching_schedules ts
        WHERE ts.class_id = v_class_id
          AND ts.session_date = NEW.exit_date
          AND ts.scheduled_teacher_id <> NEW.recorded_by
          AND EXISTS (
              SELECT 1 FROM users u
              WHERE u.user_id = ts.scheduled_teacher_id
                AND u.school_id = NEW.school_id
                AND u.is_active = true AND u.deleted_at IS NULL
          );
    END IF;

    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_notify_on_forum_comment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_post           forum_posts%ROWTYPE;
    v_commenter_name TEXT;
BEGIN
    SELECT * INTO v_post
    FROM   forum_posts WHERE post_id = NEW.post_id;

    SELECT full_name INTO v_commenter_name
    FROM   users WHERE user_id = NEW.author_user_id;

    INSERT INTO notifications (
        school_id, recipient_user_id,
        forum_post_id, forum_comment_id,
        type, title, body
    )
    SELECT DISTINCT
        NEW.school_id,
        target.user_id,
        NEW.post_id,
        NEW.comment_id,
        'FORUM_COMMENT_NEW',
        format('Komentar baru: %s', v_post.title),
        format('%s mengomentari posting yang Anda ikuti.',
               coalesce(v_commenter_name, 'Seseorang'))
    FROM (
        -- Kelompok 1: penulis posting induk
        SELECT v_post.author_user_id AS user_id

        UNION

        -- Kelompok 2: semua yang sudah beri acknowledgement
        SELECT fpa.user_id
        FROM   forum_post_acknowledgements fpa
        WHERE  fpa.post_id   = NEW.post_id
          AND  fpa.school_id = NEW.school_id

        UNION

        -- Kelompok 3: komentator sebelumnya di posting ini
        SELECT fpc.author_user_id
        FROM   forum_post_comments fpc
        WHERE  fpc.post_id    = NEW.post_id
          AND  fpc.school_id  = NEW.school_id
          AND  fpc.comment_id != NEW.comment_id
    ) AS target
    WHERE target.user_id != NEW.author_user_id;

    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_notify_on_late_arrival()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_student_name    TEXT;
    v_class_id        UUID;
    v_title_ortu      TEXT;
    v_body_ortu       TEXT;
    v_title_guru      TEXT;
    v_body_guru       TEXT;
BEGIN
    SELECT u.full_name
    INTO   v_student_name
    FROM   students s
    JOIN   users u ON u.user_id = s.user_id
    WHERE  s.student_id = NEW.student_id;

    SELECT ce.class_id
    INTO   v_class_id
    FROM   class_enrollments ce
    WHERE  ce.student_id   = NEW.student_id
      AND  ce.withdrawn_at IS NULL
    ORDER BY ce.academic_year DESC, ce.semester DESC
    LIMIT  1;

    v_title_ortu := 'Anak Anda terlambat masuk sekolah';
    v_body_ortu  := format(
        '%s datang terlambat pada %s pukul %s.%s',
        coalesce(v_student_name, 'Siswa'),
        to_char(NEW.late_date, 'DD Mon YYYY'),
        to_char(NEW.arrival_time, 'HH24:MI'),
        CASE WHEN NEW.reason IS NOT NULL
             THEN ' Keterangan: ' || NEW.reason
             ELSE ''
        END
    );

    v_title_guru := 'Siswa terlambat di kelas Anda';
    v_body_guru  := format(
        '%s terlambat masuk pada %s pukul %s.',
        coalesce(v_student_name, 'Siswa'),
        to_char(NEW.late_date, 'DD Mon YYYY'),
        to_char(NEW.arrival_time, 'HH24:MI')
    );

    -- Kirim ke semua orang tua (dengan filter school_id)
    INSERT INTO notifications
        (school_id, recipient_user_id, case_id, late_arrival_id,
         type, title, body)
    SELECT
        NEW.school_id,
        sp.parent_user_id,
        NULL,
        NEW.late_id,
        'LATE_ARRIVAL',
        v_title_ortu,
        v_body_ortu
    FROM student_parents sp
    WHERE sp.student_id = NEW.student_id
      AND sp.school_id  = NEW.school_id;

    -- Kirim ke guru yang mengajar hari ini di kelas siswa
    IF v_class_id IS NOT NULL THEN
        INSERT INTO notifications
            (school_id, recipient_user_id, case_id, late_arrival_id,
             type, title, body)
        SELECT DISTINCT ON (ts.scheduled_teacher_id)
            NEW.school_id,
            ts.scheduled_teacher_id,
            NULL,
            NEW.late_id,
            'LATE_ARRIVAL',
            v_title_guru,
            v_body_guru
        FROM teaching_schedules ts
        WHERE ts.class_id               = v_class_id
          AND ts.session_date           = NEW.late_date
          AND ts.scheduled_teacher_id  <> NEW.recorded_by
          AND EXISTS (
              SELECT 1 FROM users u
              WHERE  u.user_id    = ts.scheduled_teacher_id
                AND  u.school_id  = NEW.school_id
                AND  u.is_active  = true
                AND  u.deleted_at IS NULL
          );
    END IF;

    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_notify_on_observation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_student_user_id UUID;
BEGIN
    IF NEW.visibility <> 'STUDENT_VISIBLE' THEN
        RETURN NEW;
    END IF;

    SELECT user_id INTO v_student_user_id
    FROM   students
    WHERE  student_id = NEW.student_id;

    IF v_student_user_id IS NOT NULL
       AND v_student_user_id <> NEW.author_user_id THEN
        INSERT INTO notifications
            (school_id, recipient_user_id, case_id, type, title, body)
        VALUES (
            NEW.school_id, v_student_user_id, NULL,
            'OBSERVATION_NEW',
            'Catatan guru baru',
            'Guru menambahkan catatan baru untuk Anda.'
        );
    END IF;

    INSERT INTO notifications
        (school_id, recipient_user_id, case_id, type, title, body)
    SELECT
        NEW.school_id, sp.parent_user_id, NULL,
        'OBSERVATION_NEW',
        'Catatan guru baru tentang anak Anda',
        'Guru menambahkan catatan baru tentang anak Anda.'
    FROM   student_parents sp
    WHERE  sp.student_id     = NEW.student_id
      AND  sp.parent_user_id <> NEW.author_user_id;

    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_observation_period_lock()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_school_id UUID;
BEGIN
    SELECT school_id INTO v_school_id FROM students WHERE student_id = NEW.student_id;
    IF fn_is_period_closed(NEW.observed_at, v_school_id) THEN
        RAISE EXCEPTION
            'Periode sudah ditutup untuk tanggal %. Tidak dapat menambah/mengubah observasi.',
            NEW.observed_at USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_observation_visibility_default()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Set default visibility based on sentiment if not explicitly provided
    -- (application should always pass this, but DB enforces the rule)
    IF NEW.sentiment = 'POSITIF' AND NEW.visibility IS NULL THEN
        NEW.visibility := 'STUDENT_VISIBLE';
    ELSIF NEW.sentiment = 'NEGATIF' AND NEW.visibility IS NULL THEN
        NEW.visibility := 'INTERNAL_SCHOOL';
    END IF;

    -- Flag audit when NEGATIF is published STUDENT_VISIBLE
    IF NEW.sentiment = 'NEGATIF' AND NEW.visibility = 'STUDENT_VISIBLE' THEN
        NEW.visibility_override_flag := TRUE;
        -- Audit insert will be handled by application layer logging
        -- DB records the flag; audit trail lives in a separate audit_log table
        -- if required in a future iteration.
    END IF;

    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_observation_visibility_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.visibility IS DISTINCT FROM OLD.visibility THEN
        RAISE EXCEPTION
            'domain_invariant_violation: observation visibility is immutable after creation. '
            'observation_id=%',
            OLD.observation_id
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_owns_assessment(p_assessment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM   assessments a
        WHERE  a.id         = p_assessment_id
          AND  a.teacher_id = fn_current_user_id()
          AND  a.school_id  = fn_current_school_id()
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_owns_learning_objective(p_lo_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM   learning_objectives lo
        WHERE  lo.id         = p_lo_id
          AND  lo.teacher_id = fn_current_user_id()
          AND  lo.school_id  = fn_current_school_id()
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_parent_has_child_in_class(p_class_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.student_parents sp
        JOIN public.class_enrollments ce
          ON ce.student_id = sp.student_id
         AND ce.school_id = sp.school_id
        WHERE sp.parent_user_id = public.fn_current_user_id()
          AND sp.school_id = public.fn_current_school_id()
          AND ce.class_id = p_class_id
          AND ce.withdrawn_at IS NULL
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_parent_msg_lock_check()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_is_locked BOOLEAN;
BEGIN
    -- Only relevant for INBOUND messages linked to a case
    IF NEW.direction = 'INBOUND' AND NEW.case_id IS NOT NULL THEN
        SELECT is_locked INTO v_is_locked
        FROM cases
        WHERE case_id = NEW.case_id;

        IF v_is_locked = TRUE THEN
            RAISE EXCEPTION
                'domain_invariant_violation (INV-4): cannot send parent message to a locked case. '
                'case_id=%',
                NEW.case_id
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_pending_attendance_sessions(p_date date DEFAULT NULL::date)
 RETURNS TABLE(teacher_id uuid, session_start time without time zone, session_end time without time zone, teacher_name text, subject_name text, class_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id uuid;
BEGIN
    SELECT u.school_id INTO v_school_id
    FROM public.users u
    WHERE u.auth_user_id = auth.uid() AND u.is_active
      AND (u.role_type IN ('WAKA_KURIKULUM', 'KEPSEK', 'ADMINISTRATIVE')
           OR u.is_waka_kurikulum OR u.is_kepsek)
    LIMIT 1;
    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'Akses monitoring kurikulum ditolak' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT ts.scheduled_teacher_id, ts.session_start::time, ts.session_end::time,
        u.full_name::text, s.name::text, c.name::text
    FROM public.teaching_schedules ts
    JOIN public.users u ON u.user_id = ts.scheduled_teacher_id
    JOIN public.subjects s ON s.subject_id = ts.subject_id
    JOIN public.classes c ON c.class_id = ts.class_id
    WHERE ts.school_id = v_school_id
      AND ts.meeting_status = 'NORMAL'
      AND (p_date IS NULL OR ts.session_date = p_date)
      AND NOT EXISTS (
          SELECT 1 FROM public.attendance a
          WHERE a.schedule_id = ts.schedule_id AND NOT a.is_void
      )
    ORDER BY u.full_name, ts.session_start;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_pending_sessions_by_teacher(p_date_start date DEFAULT NULL::date, p_date_end date DEFAULT NULL::date)
 RETURNS TABLE(teacher_id uuid, teacher_name text, jumlah bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id uuid;
BEGIN
    SELECT u.school_id INTO v_school_id
    FROM public.users u
    WHERE u.auth_user_id = auth.uid() AND u.is_active
      AND (u.role_type IN ('WAKA_KURIKULUM', 'KEPSEK', 'ADMINISTRATIVE')
           OR u.is_waka_kurikulum OR u.is_kepsek)
    LIMIT 1;
    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'Akses monitoring kurikulum ditolak' USING ERRCODE = '42501';
    END IF;
    IF p_date_start > p_date_end THEN
        RAISE EXCEPTION 'Tanggal awal tidak boleh melewati tanggal akhir' USING ERRCODE = '22007';
    END IF;

    RETURN QUERY
    SELECT u.user_id, u.full_name::text, count(*)
    FROM public.teaching_schedules ts
    JOIN public.users u ON u.user_id = ts.scheduled_teacher_id
    WHERE ts.school_id = v_school_id
      AND ts.meeting_status = 'NORMAL'
      AND NOT EXISTS (
          SELECT 1 FROM public.attendance a
          WHERE a.schedule_id = ts.schedule_id AND NOT a.is_void
      )
      AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
      AND (p_date_end IS NULL OR ts.session_date <= p_date_end)
    GROUP BY u.user_id, u.full_name
    ORDER BY count(*) DESC, u.full_name;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_pending_sessions_detail(p_teacher_id uuid, p_date_start date DEFAULT NULL::date, p_date_end date DEFAULT NULL::date)
 RETURNS TABLE(session_date date, session_start time without time zone, session_end time without time zone, subject_name text, class_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id uuid;
BEGIN
    SELECT u.school_id INTO v_school_id
    FROM public.users u
    WHERE u.auth_user_id = auth.uid() AND u.is_active
      AND (u.role_type IN ('WAKA_KURIKULUM', 'KEPSEK', 'ADMINISTRATIVE')
           OR u.is_waka_kurikulum OR u.is_kepsek)
    LIMIT 1;
    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'Akses monitoring kurikulum ditolak' USING ERRCODE = '42501';
    END IF;
    IF p_date_start > p_date_end THEN
        RAISE EXCEPTION 'Tanggal awal tidak boleh melewati tanggal akhir' USING ERRCODE = '22007';
    END IF;

    RETURN QUERY
    SELECT ts.session_date, ts.session_start::time, ts.session_end::time, s.name::text, c.name::text
    FROM public.teaching_schedules ts
    JOIN public.subjects s ON s.subject_id = ts.subject_id
    JOIN public.classes c ON c.class_id = ts.class_id
    WHERE ts.school_id = v_school_id
      AND ts.scheduled_teacher_id = p_teacher_id
      AND ts.meeting_status = 'NORMAL'
      AND NOT EXISTS (
          SELECT 1 FROM public.attendance a
          WHERE a.schedule_id = ts.schedule_id AND NOT a.is_void
      )
      AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
      AND (p_date_end IS NULL OR ts.session_date <= p_date_end)
    ORDER BY ts.session_date, ts.session_start;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_pkl_attendance_period_lock()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_school_id UUID;
BEGIN
    SELECT school_id INTO v_school_id FROM students WHERE student_id = NEW.student_id;
    IF fn_is_period_closed(NEW.attendance_date, v_school_id) THEN
        RAISE EXCEPTION
            'Periode sudah ditutup untuk tanggal %. Tidak dapat menambah/mengubah absensi PKL.',
            NEW.attendance_date USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_pkl_attendance_recap(p_student_ids uuid[], p_date_start date DEFAULT NULL::date, p_date_end date DEFAULT NULL::date)
 RETURNS TABLE(student_id uuid, hadir bigint, alpa bigint, izin bigint, sakit bigint, total bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT
        s.student_id,
        COUNT(pa.pkl_attendance_id) FILTER (WHERE pa.status = 'HADIR') AS hadir,
        COUNT(pa.pkl_attendance_id) FILTER (WHERE pa.status = 'ALPA') AS alpa,
        COUNT(pa.pkl_attendance_id) FILTER (WHERE pa.status = 'IZIN') AS izin,
        COUNT(pa.pkl_attendance_id) FILTER (WHERE pa.status = 'SAKIT') AS sakit,
        COUNT(pa.pkl_attendance_id) AS total
    FROM unnest(p_student_ids) AS requested(student_id)
    JOIN public.students s
      ON s.student_id = requested.student_id
     AND s.school_id = public.fn_current_school_id()
     AND (
         public.fn_current_user_role() = 'ADMINISTRATIVE'
         OR public.fn_is_schoolwide_observer()
         OR (public.fn_is_waka_humas() AND s.student_status = 'PKL')
         OR (
             public.fn_kaprodi_program_id() IS NOT NULL
             AND s.program_id = public.fn_kaprodi_program_id()
         )
     )
    LEFT JOIN public.pkl_attendance pa
      ON pa.student_id = s.student_id
     AND pa.school_id = public.fn_current_school_id()
     AND (p_date_start IS NULL OR pa.attendance_date >= p_date_start)
     AND (p_date_end IS NULL OR pa.attendance_date <= p_date_end)
    GROUP BY s.student_id;
$function$;
CREATE OR REPLACE FUNCTION public.fn_pkl_status_consistency()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Transitioning TO PKL status
    IF NEW.student_status = 'PKL' AND OLD.student_status != 'PKL' THEN
        IF NOT EXISTS (
            SELECT 1 FROM pkl_placements
            WHERE student_id = NEW.student_id
              AND is_active  = TRUE
              AND start_date <= CURRENT_DATE
              AND end_date   >= CURRENT_DATE
        ) THEN
            RAISE EXCEPTION
                'domain_invariant_violation: student cannot be set to PKL status '
                'without an active pkl_placement. student_id=%',
                NEW.student_id
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- Transitioning AWAY from PKL status: deactivate placement
    IF OLD.student_status = 'PKL' AND NEW.student_status != 'PKL' THEN
        UPDATE pkl_placements
        SET is_active  = FALSE,
            updated_at = NOW()
        WHERE student_id = NEW.student_id
          AND is_active  = TRUE;
    END IF;

    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_platform_storage()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT jsonb_build_object(
        'db_size_bytes',  pg_database_size(current_database()),
        'db_size_pretty', pg_size_pretty(pg_database_size(current_database())),
        'tables', (
            SELECT jsonb_agg(t) FROM (
                SELECT c.relname                                    AS name,
                       pg_total_relation_size(c.oid)               AS size_bytes,
                       pg_size_pretty(pg_total_relation_size(c.oid)) AS size_pretty,
                       c.reltuples::bigint                          AS est_rows
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind = 'r'
                ORDER BY pg_total_relation_size(c.oid) DESC
                LIMIT 10
            ) t
        )
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_portal_assessment_visible(p_assessment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM assessments a
        WHERE a.id = p_assessment_id AND a.school_id = fn_current_school_id()
          AND ((fn_current_user_role() = 'SISWA' AND a.is_visible_siswa IS TRUE)
            OR (fn_current_user_role() = 'ORTU' AND a.is_visible_ortu IS TRUE))
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_portal_attendance(p_student_id uuid, p_date_start date DEFAULT NULL::date, p_date_end date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT COALESCE(jsonb_agg(row_data ORDER BY session_date DESC, session_start), '[]'::jsonb)
    FROM (
        SELECT ts.session_date, ts.session_start, jsonb_build_object(
            'schedule_id', ts.schedule_id, 'block_group_id', ts.block_group_id,
            'session_date', ts.session_date, 'session_start', ts.session_start, 'session_end', ts.session_end,
            'subject', jsonb_build_object('name', sub.name),
            'teacher', jsonb_build_object('full_name', u.full_name),
            'attendance', jsonb_build_array(jsonb_build_object(
                'attendance_id', att.attendance_id, 'status', att.status, 'is_void', att.is_void, 'notes', att.notes))
        ) AS row_data
        FROM attendance att
        JOIN teaching_schedules ts ON ts.schedule_id = att.schedule_id AND ts.school_id = att.school_id
        LEFT JOIN subjects sub ON sub.subject_id = ts.subject_id AND sub.school_id = ts.school_id
        LEFT JOIN users u ON u.user_id = ts.scheduled_teacher_id AND u.school_id = ts.school_id
        WHERE fn_portal_can_read_student(p_student_id)
          AND att.school_id = fn_current_school_id() AND att.student_id = p_student_id
          AND att.is_void IS FALSE
          AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
          AND (p_date_end IS NULL OR ts.session_date <= p_date_end)
    ) history;
$function$;
CREATE OR REPLACE FUNCTION public.fn_portal_can_read_student(p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM students s
        WHERE s.student_id = p_student_id AND s.school_id = fn_current_school_id()
          AND ((fn_current_user_role() = 'SISWA' AND s.user_id = fn_current_user_id())
            OR (fn_current_user_role() = 'ORTU' AND EXISTS (
                SELECT 1 FROM student_parents sp WHERE sp.student_id = s.student_id
                  AND sp.school_id = s.school_id AND sp.parent_user_id = fn_current_user_id()
            )))
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_portal_recap_visible(p_learning_objective_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM learning_objectives lo
        WHERE lo.id = p_learning_objective_id AND lo.school_id = fn_current_school_id()
          AND fn_current_user_role() IN ('SISWA', 'ORTU')
          AND EXISTS (SELECT 1 FROM assessments a
              WHERE a.school_id = lo.school_id AND a.class_id = lo.class_id
                AND a.subject_id = lo.subject_id AND a.academic_year = lo.academic_year
                AND a.semester = lo.semester AND a.jenis = 'SUMATIF')
          AND NOT EXISTS (SELECT 1 FROM assessments a
              WHERE a.school_id = lo.school_id AND a.class_id = lo.class_id
                AND a.subject_id = lo.subject_id AND a.academic_year = lo.academic_year
                AND a.semester = lo.semester AND a.jenis = 'SUMATIF'
                AND NOT fn_portal_assessment_visible(a.id))
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_portal_user_labels(p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, full_name text, role_type text, dudi_org_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT u.user_id, u.full_name::text, u.role_type::text, u.dudi_org_name::text
    FROM users u
    WHERE auth.uid() IS NOT NULL AND u.school_id = fn_current_school_id()
      AND cardinality(p_user_ids) <= 100 AND u.user_id = ANY(p_user_ids)
      AND fn_current_user_role() IN ('SISWA', 'ORTU')
      AND (
        u.user_id = fn_current_user_id()
        OR u.role_type NOT IN ('SISWA', 'ORTU', 'DUDI')
        OR EXISTS (SELECT 1 FROM pkl_placements pp
                   WHERE pp.dudi_user_id = u.user_id AND pp.school_id = u.school_id
                     AND fn_portal_can_read_student(pp.student_id))
        OR EXISTS (SELECT 1 FROM forum_posts fp
                   WHERE fp.author_user_id = u.user_id AND fp.school_id = u.school_id
                     AND fp.deleted_at IS NULL AND fn_can_read_forum_post(fp.post_id))
      );
$function$;
CREATE OR REPLACE FUNCTION public.fn_prepare_reapply_job(p_academic_year text, p_semester semester)
 RETURNS TABLE(job_id uuid, total_to_delete integer, already_exists boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id   uuid;
    v_role        role_type;
    v_job_id      uuid;
    v_total       integer;
    v_existed     boolean := false;
BEGIN
    -- Guard: hanya ADMINISTRATIVE
    v_school_id := fn_current_school_id();
    v_role      := fn_current_user_role();

    IF v_school_id IS NULL OR v_role IS NULL THEN
        RAISE EXCEPTION 'Sesi tidak valid — silakan login ulang';
    END IF;

    IF v_role <> 'ADMINISTRATIVE'::role_type THEN
        RAISE EXCEPTION 'Hanya akun ADMINISTRATIVE yang dapat menjalankan Terapkan Ulang';
    END IF;

    -- Coba insert job baru; kalau unique partial index menolak (23505),
    -- ambil job aktif yang sudah ada — jangan raise error ke client.
    BEGIN
        INSERT INTO schedule_reapply_jobs
            (school_id, academic_year, semester, status, created_by)
        VALUES
            (v_school_id, p_academic_year, p_semester, 'PENDING', fn_current_user_id())
        RETURNING schedule_reapply_jobs.job_id INTO v_job_id;

    EXCEPTION WHEN unique_violation THEN
        -- Job aktif sudah ada untuk periode ini — kembalikan yang sudah ada
        SELECT j.job_id INTO v_job_id
        FROM   schedule_reapply_jobs j
        WHERE  j.school_id     = v_school_id
          AND  j.academic_year = p_academic_year
          AND  j.semester      = p_semester
          AND  j.status IN ('PENDING','DELETING','DELETED','GENERATING')
        LIMIT 1;

        v_existed := true;
    END;

    -- Populate targets (idempotent via ON CONFLICT DO NOTHING)
    INSERT INTO schedule_reapply_targets (job_id, school_id, schedule_id)
    SELECT v_job_id, v_school_id, ts.schedule_id
    FROM   teaching_schedules ts
    WHERE  ts.school_id     = v_school_id
      AND  ts.academic_year = p_academic_year
      AND  ts.semester      = p_semester
      AND  ts.session_date  > CURRENT_DATE
      AND  NOT EXISTS (
               SELECT 1 FROM attendance a
               WHERE  a.schedule_id = ts.schedule_id
           )
    ON CONFLICT ON CONSTRAINT ux_reapply_targets_job_schedule
        DO NOTHING;

    -- Hitung total target (termasuk yang sudah deleted_at IS NOT NULL kalau
    -- ini job lama yang sudah sebagian dikerjakan)
    SELECT COUNT(*) INTO v_total
    FROM   schedule_reapply_targets
    WHERE  schedule_reapply_targets.job_id = v_job_id;   -- FIX: qualifier eksplisit

    -- Update total_to_delete di job
    UPDATE schedule_reapply_jobs
    SET    total_to_delete = v_total,
           updated_at      = NOW()
    WHERE  schedule_reapply_jobs.job_id = v_job_id;      -- FIX: qualifier eksplisit

    RETURN QUERY SELECT v_job_id, v_total, v_existed;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_purge_expired_student(p_student_id uuid, p_school_id uuid, p_last_table text DEFAULT NULL::text, p_last_id uuid DEFAULT NULL::uuid, p_batch_size integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_student record;
    v_cutoff timestamptz := now() - interval '6 months';
    v_tables constant text[] := ARRAY[
        'assessment_results', 'assessment_rubric_results',
        'forum_post_subjects',
        'grade_recap', 'student_grades', 'student_groups',
        'student_updates',
        'coaching_case_events', 'coaching_case_handlers', 'coaching_cases',
        'attendance', 'observations',
        'pkl_attendance', 'pkl_placements',
        'guru_wali_assignments', 'late_arrivals', 'student_exits',
        'class_enrollments',
        'forum_post_acknowledgements', 'forum_post_audience',
        'forum_post_comments', 'forum_posts',
        'notifications', 'login_devices',
        '__final'
    ];
    v_pk_columns constant text[] := ARRAY[
        'id', 'id', NULL,
        'id', 'id', 'id', 'update_id',
        'event_id', 'handler_id', 'case_id',
        'attendance_id', 'observation_id',
        'pkl_attendance_id', 'placement_id',
        'assignment_id', 'late_id', 'exit_id', 'enrollment_id',
        NULL, NULL, 'comment_id', 'post_id',
        'notification_id', 'device_id', NULL
    ];
    v_user_columns constant text[] := ARRAY[
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        NULL, NULL, 'author_user_id', 'author_user_id',
        'recipient_user_id', 'user_id', NULL
    ];
    v_stage integer;
    v_table text;
    v_pk text;
    v_user_column text;
    v_deleted integer := 0;
    v_last_id uuid;
    v_has_rows boolean := false;
    v_trigger_disabled boolean := false;
    v_purge_user_ids uuid[];
    v_student_user_id uuid;
    v_orphan_parent_ids uuid[];
BEGIN
    IF p_batch_size < 1 OR p_batch_size > 200 THEN
        RAISE EXCEPTION 'p_batch_size harus antara 1 dan 200';
    END IF;

    -- Edge function lama hanya mengirim dua argumen. Tolak aman agar deployment
    -- migration-before-edge tidak pernah dianggap sebagai purge yang selesai.
    IF p_last_table IS NULL THEN
        RAISE EXCEPTION 'p_last_table wajib untuk mode batch-aware';
    END IF;

    v_stage := array_position(v_tables, p_last_table);
    IF v_stage IS NULL THEN
        RAISE EXCEPTION 'p_last_table tidak valid: %', p_last_table;
    END IF;

    SELECT student_id, full_name, student_status, graduated_at, keluar_at, user_id
    INTO v_student
    FROM public.students
    WHERE student_id = p_student_id AND school_id = p_school_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'deleted', 0, 'has_more', false,
            'last_table', '__final', 'last_id', NULL
        );
    END IF;

    IF v_student.student_status NOT IN ('LULUS', 'KELUAR') THEN
        RAISE EXCEPTION 'Siswa "%" masih berstatus %. Hanya LULUS/KELUAR yang bisa dihapus.',
            v_student.full_name, v_student.student_status;
    END IF;
    IF v_student.student_status = 'LULUS'
       AND (v_student.graduated_at IS NULL OR v_student.graduated_at > v_cutoff) THEN
        RAISE EXCEPTION 'Siswa "%" belum melewati retensi 6 bulan.', v_student.full_name;
    END IF;
    IF v_student.student_status = 'KELUAR'
       AND (v_student.keluar_at IS NULL OR v_student.keluar_at > v_cutoff) THEN
        RAISE EXCEPTION 'Siswa "%" belum melewati retensi 6 bulan.', v_student.full_name;
    END IF;

    v_student_user_id := v_student.user_id;
    SELECT array_agg(DISTINCT candidate.user_id)
    INTO v_purge_user_ids
    FROM (
        SELECT v_student_user_id AS user_id
        WHERE v_student_user_id IS NOT NULL
        UNION ALL
        SELECT sp.parent_user_id
        FROM public.student_parents sp
        WHERE sp.student_id = p_student_id
          AND sp.school_id = p_school_id
          AND NOT EXISTS (
              SELECT 1 FROM public.student_parents other
              WHERE other.parent_user_id = sp.parent_user_id
                AND other.student_id <> p_student_id
          )
    ) candidate;

    v_table := v_tables[v_stage];
    v_pk := v_pk_columns[v_stage];
    v_user_column := v_user_columns[v_stage];

    IF v_table IN ('forum_post_subjects', 'forum_post_acknowledgements', 'forum_post_audience') THEN
        IF v_table = 'forum_post_subjects' THEN
            WITH picked AS (
                SELECT post_id, student_id
                FROM public.forum_post_subjects
                WHERE student_id = p_student_id AND school_id = p_school_id
                ORDER BY post_id, student_id LIMIT p_batch_size
            ), deleted_rows AS (
                DELETE FROM public.forum_post_subjects target USING picked p
                WHERE target.post_id = p.post_id AND target.student_id = p.student_id
                RETURNING 1
            ) SELECT count(*)::integer INTO v_deleted FROM deleted_rows;
            SELECT EXISTS (SELECT 1 FROM public.forum_post_subjects
                WHERE student_id = p_student_id AND school_id = p_school_id) INTO v_has_rows;
        ELSIF v_table = 'forum_post_acknowledgements' THEN
            WITH picked AS (
                SELECT post_id, user_id FROM public.forum_post_acknowledgements
                WHERE user_id = ANY(COALESCE(v_purge_user_ids, ARRAY[]::uuid[]))
                  AND school_id = p_school_id
                ORDER BY post_id, user_id LIMIT p_batch_size
            ), deleted_rows AS (
                DELETE FROM public.forum_post_acknowledgements target USING picked p
                WHERE target.post_id = p.post_id AND target.user_id = p.user_id
                RETURNING 1
            ) SELECT count(*)::integer INTO v_deleted FROM deleted_rows;
            SELECT EXISTS (SELECT 1 FROM public.forum_post_acknowledgements
                WHERE user_id = ANY(COALESCE(v_purge_user_ids, ARRAY[]::uuid[]))
                  AND school_id = p_school_id) INTO v_has_rows;
        ELSE
            WITH picked AS (
                SELECT post_id, user_id FROM public.forum_post_audience
                WHERE user_id = ANY(COALESCE(v_purge_user_ids, ARRAY[]::uuid[]))
                  AND school_id = p_school_id
                ORDER BY post_id, user_id LIMIT p_batch_size
            ), deleted_rows AS (
                DELETE FROM public.forum_post_audience target USING picked p
                WHERE target.post_id = p.post_id AND target.user_id = p.user_id
                RETURNING 1
            ) SELECT count(*)::integer INTO v_deleted FROM deleted_rows;
            SELECT EXISTS (SELECT 1 FROM public.forum_post_audience
                WHERE user_id = ANY(COALESCE(v_purge_user_ids, ARRAY[]::uuid[]))
                  AND school_id = p_school_id) INTO v_has_rows;
        END IF;

        IF v_has_rows THEN
            RETURN jsonb_build_object('deleted', v_deleted, 'has_more', true,
                'last_table', v_table, 'last_id', NULL);
        END IF;

    ELSIF v_table IN ('student_updates', 'coaching_case_events', 'coaching_case_handlers') THEN
        IF v_table = 'coaching_case_events' THEN
            ALTER TABLE public.coaching_case_events DISABLE TRIGGER trg_coaching_case_events_immutable;
            v_trigger_disabled := true;
        END IF;

        EXECUTE format(
            'WITH picked AS (
                SELECT target.%1$I FROM public.%2$I target
                WHERE target.school_id = $2
                  AND target.case_id IN (
                      SELECT case_id FROM public.coaching_cases
                      WHERE student_id = $1 AND school_id = $2
                  )
                  AND ($3 IS NULL OR target.%1$I > $3)
                ORDER BY target.%1$I LIMIT $4
             ), deleted_rows AS (
                DELETE FROM public.%2$I target USING picked p
                WHERE target.%1$I = p.%1$I RETURNING target.%1$I
             )
             SELECT count(*)::integer,
                    (SELECT %1$I FROM picked ORDER BY %1$I DESC LIMIT 1)
             FROM deleted_rows', v_pk, v_table
        ) INTO v_deleted, v_last_id
        USING p_student_id, p_school_id, p_last_id, p_batch_size;

        IF v_table = 'coaching_case_events' THEN
            ALTER TABLE public.coaching_case_events ENABLE TRIGGER trg_coaching_case_events_immutable;
            v_trigger_disabled := false;
        END IF;

        IF v_last_id IS NOT NULL THEN
            EXECUTE format(
                'SELECT EXISTS (
                    SELECT 1 FROM public.%1$I target
                    WHERE target.school_id = $2
                      AND target.case_id IN (
                          SELECT case_id FROM public.coaching_cases
                          WHERE student_id = $1 AND school_id = $2
                      ) AND target.%2$I > $3
                )', v_table, v_pk
            ) INTO v_has_rows USING p_student_id, p_school_id, v_last_id;
        END IF;

        IF v_has_rows THEN
            RETURN jsonb_build_object('deleted', v_deleted, 'has_more', true,
                'last_table', v_table, 'last_id', v_last_id);
        END IF;

    ELSIF v_table = '__final' THEN
        INSERT INTO public.pending_auth_deletions
            (school_id, purge_student_id, auth_user_id)
        SELECT p_school_id, p_student_id, u.auth_user_id
        FROM public.users u
        WHERE u.user_id = ANY(COALESCE(v_purge_user_ids, ARRAY[]::uuid[]))
          AND u.school_id = p_school_id
          AND u.auth_user_id IS NOT NULL
        ON CONFLICT (auth_user_id) DO UPDATE SET
            school_id = EXCLUDED.school_id,
            purge_student_id = EXCLUDED.purge_student_id,
            processed_at = NULL,
            last_error = NULL;

        SELECT array_agg(sp.parent_user_id)
        INTO v_orphan_parent_ids
        FROM public.student_parents sp
        WHERE sp.student_id = p_student_id
          AND sp.school_id = p_school_id
          AND sp.parent_user_id = ANY(COALESCE(v_purge_user_ids, ARRAY[]::uuid[]));

        DELETE FROM public.student_parents
        WHERE student_id = p_student_id AND school_id = p_school_id;
        GET DIAGNOSTICS v_deleted = ROW_COUNT;

        IF v_student_user_id IS NOT NULL THEN
            DELETE FROM public.users
            WHERE user_id = v_student_user_id AND school_id = p_school_id;
            v_deleted := v_deleted + CASE WHEN FOUND THEN 1 ELSE 0 END;
        END IF;

        DELETE FROM public.students
        WHERE student_id = p_student_id AND school_id = p_school_id;
        v_deleted := v_deleted + CASE WHEN FOUND THEN 1 ELSE 0 END;

        IF COALESCE(array_length(v_orphan_parent_ids, 1), 0) > 0 THEN
            WITH deleted_parents AS (
                DELETE FROM public.users
                WHERE user_id = ANY(v_orphan_parent_ids)
                  AND school_id = p_school_id
                RETURNING 1
            )
            SELECT v_deleted + count(*)::integer INTO v_deleted FROM deleted_parents;
        END IF;

        RETURN jsonb_build_object('deleted', v_deleted, 'has_more', false,
            'last_table', '__final', 'last_id', NULL);

    ELSE
        IF v_user_column IS NULL THEN
            EXECUTE format(
                'WITH picked AS (
                    SELECT %1$I FROM public.%2$I
                    WHERE student_id = $1 AND school_id = $2
                      AND ($3 IS NULL OR %1$I > $3)
                    ORDER BY %1$I LIMIT $4
                 ), deleted_rows AS (
                    DELETE FROM public.%2$I target USING picked p
                    WHERE target.%1$I = p.%1$I RETURNING target.%1$I
                 )
                 SELECT count(*)::integer,
                        (SELECT %1$I FROM picked ORDER BY %1$I DESC LIMIT 1)
                 FROM deleted_rows', v_pk, v_table
            ) INTO v_deleted, v_last_id
            USING p_student_id, p_school_id, p_last_id, p_batch_size;

            IF v_last_id IS NOT NULL THEN
                EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%1$I
                    WHERE student_id = $1 AND school_id = $2 AND %2$I > $3)', v_table, v_pk)
                INTO v_has_rows USING p_student_id, p_school_id, v_last_id;
            END IF;
        ELSE
            EXECUTE format(
                'WITH picked AS (
                    SELECT %1$I FROM public.%2$I
                    WHERE %3$I = ANY($1) AND school_id = $2
                      AND ($3 IS NULL OR %1$I > $3)
                    ORDER BY %1$I LIMIT $4
                 ), deleted_rows AS (
                    DELETE FROM public.%2$I target USING picked p
                    WHERE target.%1$I = p.%1$I RETURNING target.%1$I
                 )
                 SELECT count(*)::integer,
                        (SELECT %1$I FROM picked ORDER BY %1$I DESC LIMIT 1)
                 FROM deleted_rows', v_pk, v_table, v_user_column
            ) INTO v_deleted, v_last_id
            USING COALESCE(v_purge_user_ids, ARRAY[]::uuid[]), p_school_id, p_last_id, p_batch_size;

            IF v_last_id IS NOT NULL THEN
                EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%1$I
                    WHERE %2$I = ANY($1) AND school_id = $2 AND %3$I > $3)',
                    v_table, v_user_column, v_pk)
                INTO v_has_rows USING COALESCE(v_purge_user_ids, ARRAY[]::uuid[]), p_school_id, v_last_id;
            END IF;
        END IF;

        IF v_has_rows THEN
            RETURN jsonb_build_object('deleted', v_deleted, 'has_more', true,
                'last_table', v_table, 'last_id', v_last_id);
        END IF;
    END IF;

    RETURN jsonb_build_object('deleted', v_deleted, 'has_more', true,
        'last_table', v_tables[v_stage + 1], 'last_id', NULL);
EXCEPTION
    WHEN OTHERS THEN
        IF v_trigger_disabled THEN
            ALTER TABLE public.coaching_case_events ENABLE TRIGGER trg_coaching_case_events_immutable;
        END IF;
        RAISE;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_reapply_batch(p_job_id uuid, p_batch_size integer DEFAULT 500)
 RETURNS TABLE(deleted_this_batch integer, total_deleted integer, done boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id   uuid;
    v_role        role_type;
    v_job         schedule_reapply_jobs%ROWTYPE;
    v_batch_ids   uuid[];
    v_batch_count integer := 0;
    v_new_deleted integer;
    v_is_done     boolean := false;
BEGIN
    -- Guard: hanya ADMINISTRATIVE
    v_school_id := fn_current_school_id();
    v_role      := fn_current_user_role();

    IF v_school_id IS NULL OR v_role IS NULL THEN
        RAISE EXCEPTION 'Sesi tidak valid â€” silakan login ulang';
    END IF;

    IF v_role <> 'ADMINISTRATIVE'::role_type THEN
        RAISE EXCEPTION 'Hanya akun ADMINISTRATIVE yang dapat menjalankan batch reapply';
    END IF;

    -- Validasi p_batch_size: cegah nilai ekstrem yang bisa menyebabkan timeout
    IF p_batch_size < 1 OR p_batch_size > 1000 THEN
        RAISE EXCEPTION 'p_batch_size harus antara 1 dan 1000 (diterima: %)', p_batch_size;
    END IF;

    -- Ambil dan lock job â€” verifikasi ownership school_id sekaligus
    SELECT * INTO v_job
    FROM   schedule_reapply_jobs
    WHERE  job_id    = p_job_id
      AND  school_id = v_school_id  -- cross-tenant guard
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job % tidak ditemukan atau bukan milik sekolah Anda', p_job_id;
    END IF;

    -- Guard: tolak eksplisit kalau job sudah terminal
    IF v_job.status IN ('DONE', 'FAILED') THEN
        RAISE EXCEPTION
            'Job % sudah berstatus % â€” tidak bisa dijalankan ulang. '
            'Buat job baru via fn_prepare_reapply_job.',
            p_job_id, v_job.status;
    END IF;

    -- Idempotent: kalau sudah DELETED (semua batch selesai), return langsung
    IF v_job.status = 'DELETED' THEN
        RETURN QUERY SELECT 0, v_job.deleted_count, true;
        RETURN;
    END IF;

    -- Ambil batch target yang belum dihapus.
    -- FOR UPDATE SKIP LOCKED: concurrent call untuk job yang sama akan
    -- mengambil subset baris berbeda, bukan baris yang sama dua kali.
    SELECT ARRAY_AGG(t.schedule_id ORDER BY t.target_id)
    INTO   v_batch_ids
    FROM  (
        SELECT target_id, schedule_id
        FROM   schedule_reapply_targets
        WHERE  job_id     = p_job_id
          AND  deleted_at IS NULL
        ORDER BY target_id
        LIMIT  p_batch_size
        FOR UPDATE SKIP LOCKED
    ) t;

    IF v_batch_ids IS NULL OR array_length(v_batch_ids, 1) = 0 THEN
        -- Tidak ada baris lagi â€” sudah selesai (mungkin concurrent batch
        -- yang lain baru saja menyelesaikan sisanya)
        UPDATE schedule_reapply_jobs
        SET    status     = 'DELETED',
               updated_at = NOW()
        WHERE  job_id = p_job_id
          AND  status IN ('PENDING', 'DELETING');

        RETURN QUERY
            SELECT 0, v_job.deleted_count, true;
        RETURN;
    END IF;

    v_batch_count := array_length(v_batch_ids, 1);

    -- Set status DELETING kalau masih PENDING
    UPDATE schedule_reapply_jobs
    SET    status     = 'DELETING',
           updated_at = NOW()
    WHERE  job_id = p_job_id
      AND  status  = 'PENDING';

    -- â”€â”€ Urutan DELETE (sama dengan fn_reapply_schedule_templates lama) â”€â”€â”€â”€
    -- 1. Nullable FK: set NULL dulu (jaga data observasi dan jurnal guru)
    UPDATE observations
    SET    schedule_id = NULL
    WHERE  schedule_id = ANY(v_batch_ids);

    UPDATE teacher_journals
    SET    schedule_id = NULL
    WHERE  schedule_id = ANY(v_batch_ids);

    -- 2. NOT NULL FK: hapus child records sebelum induk
    DELETE FROM teacher_attendance_log
    WHERE  schedule_id = ANY(v_batch_ids);

    DELETE FROM substitute_schedules
    WHERE  schedule_id = ANY(v_batch_ids);

    -- 3. Hapus sesi (attendance terlindungi oleh RESTRICT + filter FASE 1)
    DELETE FROM teaching_schedules
    WHERE  schedule_id = ANY(v_batch_ids);

    -- â”€â”€ Mark targets batch ini sebagai done â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    UPDATE schedule_reapply_targets
    SET    deleted_at = NOW()
    WHERE  job_id      = p_job_id
      AND  schedule_id = ANY(v_batch_ids);

    -- â”€â”€ Update progress di job â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    UPDATE schedule_reapply_jobs
    SET    deleted_count = deleted_count + v_batch_count,
           updated_at    = NOW()
    WHERE  job_id = p_job_id
    RETURNING deleted_count INTO v_new_deleted;

    -- Cek apakah sudah tidak ada target tersisa
    IF NOT EXISTS (
        SELECT 1 FROM schedule_reapply_targets
        WHERE  job_id     = p_job_id
          AND  deleted_at IS NULL
    ) THEN
        UPDATE schedule_reapply_jobs
        SET    status     = 'DELETED',
               updated_at = NOW()
        WHERE  job_id = p_job_id;

        v_is_done := true;
    END IF;

    RETURN QUERY SELECT v_batch_count, v_new_deleted, v_is_done;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_reapply_schedule_templates(p_academic_year text, p_semester semester, p_school_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_deleted_sess  integer := 0;
    v_deleted_sub   integer := 0;
    v_result        jsonb;
BEGIN
    SET LOCAL statement_timeout = 0;

    -- Sesi target: masa depan, milik sekolah ini, belum ada absensi
    CREATE TEMP TABLE _reapply_target ON COMMIT DROP AS
    SELECT ts.schedule_id
    FROM   teaching_schedules ts
    WHERE  ts.school_id     = p_school_id
      AND  ts.academic_year = p_academic_year
      AND  ts.semester      = p_semester
      AND  ts.session_date  > CURRENT_DATE
      AND  NOT EXISTS (
               SELECT 1 FROM attendance a
               WHERE  a.schedule_id = ts.schedule_id
           );

    -- Putus referensi nullable (jangan hapus data observasi/jurnal guru)
    UPDATE observations
    SET    schedule_id = NULL
    WHERE  schedule_id IN (SELECT schedule_id FROM _reapply_target);

    UPDATE teacher_journals
    SET    schedule_id = NULL
    WHERE  schedule_id IN (SELECT schedule_id FROM _reapply_target);

    -- Hapus child records NOT NULL sebelum hapus sesi
    DELETE FROM teacher_attendance_log
    WHERE  schedule_id IN (SELECT schedule_id FROM _reapply_target);

    DELETE FROM substitute_schedules
    WHERE  schedule_id IN (SELECT schedule_id FROM _reapply_target);
    GET DIAGNOSTICS v_deleted_sub = ROW_COUNT;

    -- Hapus sesi target
    DELETE FROM teaching_schedules
    WHERE  schedule_id IN (SELECT schedule_id FROM _reapply_target);
    GET DIAGNOSTICS v_deleted_sess = ROW_COUNT;

    DROP TABLE _reapply_target;

    -- Generate ulang dari template terkini (hanya mengisi yang kosong ke depan)
    SELECT fn_apply_schedule_templates(p_academic_year, p_semester, p_school_id)
    INTO   v_result;

    RETURN jsonb_build_object(
        'sessions_deleted',     v_deleted_sess,
        'substitutes_deleted',  v_deleted_sub,
        'templates_found',      (v_result->>'templates_found')::int,
        'assignments_upserted', (v_result->>'assignments_upserted')::int,
        'schedules_generated',  (v_result->>'schedules_generated')::int
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_register_login_device(p_device_hash text, p_user_agent text DEFAULT ''::text, p_label text DEFAULT ''::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id   UUID := fn_current_user_id();
    v_school_id UUID := fn_current_school_id();
    v_device    login_devices%ROWTYPE;
    v_count     INT;
    v_label     TEXT := left(coalesce(nullif(btrim(p_label), ''), 'perangkat tak dikenal'), 120);
BEGIN
    IF v_user_id IS NULL OR v_school_id IS NULL THEN
        RAISE EXCEPTION 'Sesi tidak valid';
    END IF;
    IF p_device_hash IS NULL OR length(btrim(p_device_hash)) < 16 THEN
        RAISE EXCEPTION 'device_hash tidak valid';
    END IF;

    -- Sudah dikenal? → perbarui last_seen, tidak ada alarm.
    SELECT * INTO v_device
    FROM   login_devices
    WHERE  user_id = v_user_id AND device_hash = p_device_hash;

    IF FOUND THEN
        UPDATE login_devices SET last_seen = now(), label = v_label
        WHERE  device_id = v_device.device_id;
        RETURN 'known';
    END IF;

    -- Perangkat baru: apakah ini perangkat PERTAMA user?
    SELECT count(*) INTO v_count FROM login_devices WHERE user_id = v_user_id;

    INSERT INTO login_devices (user_id, school_id, device_hash, user_agent, label)
    VALUES (v_user_id, v_school_id, p_device_hash, left(coalesce(p_user_agent, ''), 400), v_label);

    -- Perangkat pertama = senyap (login perdana wajar).
    IF v_count = 0 THEN
        RETURN 'first';
    END IF;

    -- Perangkat baru ke-2+ → alarm tahan-lama di lonceng.
    INSERT INTO notifications (school_id, recipient_user_id, case_id, type, title, body)
    VALUES (
        v_school_id, v_user_id, NULL, 'LOGIN_NEW_DEVICE',
        'Login dari perangkat baru',
        format('Akun Anda baru saja login dari perangkat baru: %s. Jika ini bukan Anda, segera ganti kata sandi.', v_label)
    );

    RETURN 'new';
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_remove_school_admin(p_actor_user_id uuid, p_target_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id uuid;
    v_target record;
    v_admin_count integer;
BEGIN
    SELECT school_id INTO v_school_id
    FROM users
    WHERE user_id = p_actor_user_id
      AND is_active IS TRUE
      AND deleted_at IS NULL
      AND (role_type = 'KEPSEK'::role_type OR is_kepsek IS TRUE)
    LIMIT 1;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'Akses ditolak: hanya Kepala Sekolah aktif yang dapat menghapus admin';
    END IF;
    IF p_actor_user_id = p_target_user_id THEN
        RAISE EXCEPTION 'Tidak dapat menghapus akun Anda sendiri';
    END IF;

    -- Semua penghapusan admin memakai kunci sekolah yang sama, sehingga dua
    -- request terakhir tidak dapat sama-sama melewati batas minimum admin.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_school_id::text, 0));

    SELECT auth_user_id, role_type, full_name
    INTO v_target
    FROM users
    WHERE user_id = p_target_user_id
      AND school_id = v_school_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Akun tidak ditemukan di sekolah ini';
    END IF;
    IF v_target.role_type <> 'ADMINISTRATIVE'::role_type THEN
        RAISE EXCEPTION 'Hanya akun ADMINISTRATIVE yang dapat dihapus dari sini';
    END IF;

    SELECT COUNT(*) INTO v_admin_count
    FROM users
    WHERE school_id = v_school_id
      AND role_type = 'ADMINISTRATIVE'::role_type
      AND is_active IS TRUE
      AND deleted_at IS NULL;

    IF v_admin_count <= 1 THEN
        RAISE EXCEPTION 'Tidak dapat menghapus admin terakhir sekolah ini';
    END IF;

    PERFORM set_config('app.bypass_users_guard', 'on', true);
    UPDATE users
    SET deleted_at = NOW(), is_active = FALSE
    WHERE user_id = p_target_user_id
      AND school_id = v_school_id;

    RETURN jsonb_build_object(
        'deleted', TRUE,
        'user_id', p_target_user_id,
        'auth_user_id', v_target.auth_user_id,
        'full_name', v_target.full_name
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_resolve_login_email(p_identifier text, p_school_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ SELECT email FROM users WHERE login_identifier = p_identifier AND school_id = p_school_id AND is_active = TRUE AND deleted_at IS NULL LIMIT 1; $function$;
CREATE OR REPLACE FUNCTION public.fn_resolve_teacher_names(p_auth_ids uuid[])
 RETURNS TABLE(auth_user_id uuid, full_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT auth_user_id, full_name
    FROM public.users
    WHERE auth_user_id = ANY(p_auth_ids)
      AND school_id = fn_current_school_id();
$function$;
CREATE OR REPLACE FUNCTION public.fn_save_schedule_day(p_academic_year text, p_semester semester, p_day_of_week day_of_week, p_slots jsonb, p_templates jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id UUID := fn_current_school_id();
    v_slot JSONB;
    v_tpl JSONB;
BEGIN
    IF fn_current_user_role() <> 'ADMINISTRATIVE' OR v_school_id IS NULL THEN
        RAISE EXCEPTION 'akses ditolak: hanya ADMINISTRATIVE yang dapat menyimpan jadwal'
            USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(p_templates, '[]'::jsonb)) item
        WHERE NOT EXISTS (
            SELECT 1 FROM classes c
            WHERE c.class_id = (item->>'class_id')::UUID
              AND c.school_id = v_school_id
        )
        OR NOT EXISTS (
            SELECT 1 FROM users u
            WHERE u.user_id = (item->>'teacher_id')::UUID
              AND u.school_id = v_school_id
              AND u.deleted_at IS NULL
        )
    ) THEN
        RAISE EXCEPTION 'Template jadwal berisi kelas atau guru dari sekolah lain'
            USING ERRCODE = '42501';
    END IF;

    DELETE FROM schedule_time_slots
    WHERE academic_year = p_academic_year AND semester = p_semester
      AND day_of_week = p_day_of_week AND school_id = v_school_id;

    FOR v_slot IN SELECT * FROM jsonb_array_elements(COALESCE(p_slots, '[]'::jsonb)) LOOP
        INSERT INTO schedule_time_slots (
            academic_year, semester, day_of_week, school_id, slot_number,
            start_time, end_time, is_break, break_label
        ) VALUES (
            p_academic_year, p_semester, p_day_of_week, v_school_id,
            (v_slot->>'slot_number')::INTEGER,
            (v_slot->>'start_time')::TIME, (v_slot->>'end_time')::TIME,
            COALESCE((v_slot->>'is_break')::BOOLEAN, FALSE),
            NULLIF(v_slot->>'break_label', '')
        );
    END LOOP;

    DELETE FROM schedule_templates
    WHERE academic_year = p_academic_year AND semester = p_semester
      AND day_of_week = p_day_of_week AND school_id = v_school_id;

    FOR v_tpl IN SELECT * FROM jsonb_array_elements(COALESCE(p_templates, '[]'::jsonb)) LOOP
        INSERT INTO schedule_templates (
            academic_year, semester, day_of_week, school_id,
            start_time, end_time, class_id, teacher_id, subject_label
        ) VALUES (
            p_academic_year, p_semester, p_day_of_week, v_school_id,
            (v_tpl->>'start_time')::TIME, (v_tpl->>'end_time')::TIME,
            (v_tpl->>'class_id')::UUID, (v_tpl->>'teacher_id')::UUID,
            NULLIF(v_tpl->>'subject_label', '')
        );
    END LOOP;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_save_schedule_templates(p_academic_year text, p_semester semester, p_day_of_week day_of_week, p_templates jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id UUID := fn_current_school_id();
    v_tpl JSONB;
BEGIN
    IF fn_current_user_role() <> 'ADMINISTRATIVE' OR v_school_id IS NULL THEN
        RAISE EXCEPTION 'akses ditolak: hanya ADMINISTRATIVE yang dapat menyimpan schedule templates'
            USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(p_templates, '[]'::jsonb)) item
        WHERE NOT EXISTS (
            SELECT 1 FROM classes c
            WHERE c.class_id = (item->>'class_id')::UUID
              AND c.school_id = v_school_id
        )
        OR NOT EXISTS (
            SELECT 1 FROM users u
            WHERE u.user_id = (item->>'teacher_id')::UUID
              AND u.school_id = v_school_id
              AND u.deleted_at IS NULL
        )
    ) THEN
        RAISE EXCEPTION 'Template jadwal berisi kelas atau guru dari sekolah lain'
            USING ERRCODE = '42501';
    END IF;

    DELETE FROM schedule_templates
    WHERE academic_year = p_academic_year AND semester = p_semester
      AND day_of_week = p_day_of_week AND school_id = v_school_id;

    FOR v_tpl IN SELECT * FROM jsonb_array_elements(COALESCE(p_templates, '[]'::jsonb)) LOOP
        INSERT INTO schedule_templates (
            academic_year, semester, day_of_week, school_id,
            start_time, end_time, class_id, teacher_id, subject_label
        ) VALUES (
            p_academic_year, p_semester, p_day_of_week, v_school_id,
            (v_tpl->>'start_time')::TIME, (v_tpl->>'end_time')::TIME,
            (v_tpl->>'class_id')::UUID, (v_tpl->>'teacher_id')::UUID,
            NULLIF(v_tpl->>'subject_label', '')
        );
    END LOOP;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_save_time_slots(p_academic_year text, p_semester semester, p_day_of_week day_of_week, p_slots jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id UUID;
    v_role      TEXT;
    v_slot      JSONB;
    v_idx       INTEGER := 0;
BEGIN
    v_school_id := fn_current_school_id();
    v_role      := fn_current_user_role();

    IF v_role != 'ADMINISTRATIVE' THEN
        RAISE EXCEPTION 'Tidak diizinkan: hanya ADMINISTRATIVE yang dapat menyimpan time slots'
            USING ERRCODE = '42501';
    END IF;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'school_id tidak terdeteksi untuk user ini'
            USING ERRCODE = '42501';
    END IF;

    -- Hapus slot lama untuk tahun ajaran, semester, hari, dan sekolah ini
    DELETE FROM schedule_time_slots
    WHERE academic_year = p_academic_year
      AND semester      = p_semester
      AND day_of_week   = p_day_of_week
      AND school_id     = v_school_id;

    -- Insert slot baru jika ada
    IF jsonb_array_length(p_slots) > 0 THEN
        FOR v_slot IN SELECT * FROM jsonb_array_elements(p_slots) LOOP
            v_idx := v_idx + 1;
            INSERT INTO schedule_time_slots (
                academic_year, semester, day_of_week, school_id,
                slot_number, start_time, end_time, is_break, break_label
            ) VALUES (
                p_academic_year,
                p_semester,
                p_day_of_week,
                v_school_id,
                (v_slot->>'slot_number')::INTEGER,
                (v_slot->>'start_time')::TIME,
                (v_slot->>'end_time')::TIME,
                COALESCE((v_slot->>'is_break')::BOOLEAN, FALSE),
                NULLIF(v_slot->>'break_label', '')
            );
        END LOOP;
    END IF;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_school_branding(p_slug text)
 RETURNS TABLE(school_id uuid, name text, logo_url text, primary_color text, secondary_color text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ SELECT school_id, name, logo_url, primary_color, secondary_color FROM schools WHERE slug = p_slug AND is_active = true LIMIT 1; $function$;
CREATE OR REPLACE FUNCTION public.fn_school_staff_health()
 RETURNS TABLE(school_id uuid, kepsek_count bigint, waka_kurikulum_count bigint, waka_kesiswaan_count bigint, waka_humas_count bigint, staff_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT school_id,
        COUNT(*) FILTER (WHERE role_type = 'KEPSEK' OR is_kepsek) AS kepsek_count,
        COUNT(*) FILTER (WHERE role_type = 'WAKA_KURIKULUM' OR is_waka_kurikulum) AS waka_kurikulum_count,
        COUNT(*) FILTER (WHERE role_type = 'WAKA_KESISWAAN' OR is_waka_kesiswaan) AS waka_kesiswaan_count,
        COUNT(*) FILTER (WHERE role_type = 'WAKA_HUMAS' OR is_waka_humas) AS waka_humas_count,
        COUNT(*) FILTER (WHERE role_type NOT IN ('SISWA','ORTU','DUDI','ADMINISTRATIVE','STAKEHOLDER')) AS staff_count
    FROM users WHERE is_active = TRUE AND deleted_at IS NULL GROUP BY school_id;
$function$;
CREATE OR REPLACE FUNCTION public.fn_school_student_health()
 RETURNS TABLE(school_id uuid, student_count bigint, provisioned_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT school_id,
        COUNT(*) AS student_count,
        COUNT(*) FILTER (WHERE user_id IS NOT NULL) AS provisioned_count
    FROM students GROUP BY school_id;
$function$;
CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_stakeholder_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id uuid;
    v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
    SELECT school_id INTO v_school_id
    FROM users
    WHERE auth_user_id = auth.uid()
      AND is_active IS TRUE
      AND deleted_at IS NULL
      AND (role_type IN ('KEPSEK', 'STAKEHOLDER') OR is_kepsek IS TRUE)
    LIMIT 1;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'akses ditolak: hanya kepsek/stakeholder aktif'
            USING ERRCODE = '42501';
    END IF;

    RETURN (
        SELECT jsonb_build_object(
            'total_siswa',
                (SELECT count(*) FROM students
                 WHERE student_status = 'AKTIF' AND school_id = v_school_id),
            'total_pkl',
                (SELECT count(*) FROM students
                 WHERE student_status = 'PKL' AND school_id = v_school_id),
            'total_staf',
                (SELECT count(*) FROM users
                 WHERE role_type NOT IN ('SISWA','ORTU','DUDI','ADMINISTRATIVE','STAKEHOLDER')
                   AND is_active IS TRUE AND deleted_at IS NULL
                   AND school_id = v_school_id),
            'total_program',
                (SELECT count(*) FROM programs
                 WHERE is_active IS TRUE AND school_id = v_school_id),
            'total_kelas',
                (SELECT count(*) FROM classes
                 WHERE is_active IS TRUE AND school_id = v_school_id),
            'sesi_hari_ini',
                (SELECT count(*) FROM teaching_schedules
                 WHERE session_date = v_today AND school_id = v_school_id),
            'hadir_hari_ini',
                (SELECT count(*)
                 FROM attendance a
                 JOIN teaching_schedules ts ON ts.schedule_id = a.schedule_id
                 WHERE a.is_void = FALSE AND a.status = 'HADIR'
                   AND ts.session_date = v_today
                   AND a.school_id = v_school_id),
            'kehadiran_bulan_pct',
                (SELECT CASE WHEN count(*) = 0 THEN NULL
                        ELSE round(100.0 * count(*) FILTER (WHERE a.status = 'HADIR') / count(*), 1)
                        END
                 FROM attendance a
                 JOIN teaching_schedules ts ON ts.schedule_id = a.schedule_id
                 WHERE a.is_void = FALSE
                   AND ts.session_date >= date_trunc('month', v_today)
                   AND a.school_id = v_school_id),
            'updated_at', now()
        )
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_student_enrolled_in_class(p_class_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.class_enrollments ce
        WHERE ce.class_id = p_class_id
          AND ce.student_id = public.fn_current_student_id()
          AND ce.school_id = public.fn_current_school_id()
          AND ce.withdrawn_at IS NULL
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_student_in_current_school(p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM students st
    WHERE st.student_id = p_student_id
      AND st.school_id  = fn_current_school_id()
  );
$function$;
CREATE OR REPLACE FUNCTION public.fn_student_is_on_pkl(p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM pkl_placements pp
        WHERE pp.student_id  = p_student_id
          AND pp.school_id   = fn_current_school_id()
          AND pp.start_date <= CURRENT_DATE
          AND (pp.end_date IS NULL OR pp.end_date >= CURRENT_DATE)
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_student_nis_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.nis IS DISTINCT FROM OLD.nis THEN
        RAISE EXCEPTION
            'domain_invariant_violation: nis is immutable after creation. '
            'student_id=%, old_nis=%, attempted_nis=%',
            OLD.student_id, OLD.nis, NEW.nis
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_sync_attendance_batch(p_schedule_id uuid, p_submitted_by uuid, p_records jsonb, p_meeting_status text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_is_substitute boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_record        JSONB;
    v_count         INTEGER := 0;
    v_activity_type VARCHAR(50);
    v_schedule      teaching_schedules%ROWTYPE;
BEGIN
    SELECT * INTO v_schedule
    FROM teaching_schedules
    WHERE schedule_id = p_schedule_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'schedule_not_found: schedule_id = %', p_schedule_id
            USING ERRCODE = 'P0004';
    END IF;

    -- a. UPSERT each attendance record
    FOR v_record IN SELECT * FROM jsonb_array_elements(p_records)
    LOOP
        INSERT INTO attendance (
            schedule_id,
            student_id,
            status,
            source,
            recorded_by_user_id,
            is_void,
            void_reason
        )
        VALUES (
            p_schedule_id,
            (v_record->>'student_id')::UUID,
            (v_record->>'status')::attendance_status,
            (v_record->>'source')::attendance_source,
            p_submitted_by,
            FALSE,
            NULL
        )
        ON CONFLICT (schedule_id, student_id)
        DO UPDATE SET
            status              = EXCLUDED.status,
            source              = EXCLUDED.source,
            recorded_by_user_id = EXCLUDED.recorded_by_user_id,
            is_void             = FALSE,
            void_reason         = NULL,
            updated_at          = NOW()
        WHERE attendance.is_void = FALSE;

        v_count := v_count + 1;
    END LOOP;

    -- b. UPDATE meeting_status if provided
    IF p_meeting_status IS NOT NULL THEN
        UPDATE teaching_schedules
        SET meeting_status = p_meeting_status::meeting_status,
            updated_at     = NOW()
        WHERE schedule_id = p_schedule_id;
    END IF;

    -- c. INSERT teacher_attendance_log signal (TN-02)
    v_activity_type := CASE
        WHEN p_is_substitute THEN 'SUBSTITUTE_ATTENDANCE_SUBMITTED'
        ELSE 'ATTENDANCE_SUBMITTED'
    END;

    INSERT INTO teacher_attendance_log (schedule_id, user_id, activity_type)
    SELECT p_schedule_id, p_submitted_by, v_activity_type
    WHERE v_schedule.session_date     = CURRENT_DATE
      AND v_schedule.teacher_indicator = 'PENDING_EVALUATION'
    ON CONFLICT DO NOTHING;

    -- d. Record idempotency key — sertakan school_id eksplisit karena
    --    fn_auto_set_school_id tidak menangani tabel sync_idempotency.
    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO sync_idempotency (
            idempotency_key,
            function_name,
            result_json,
            school_id
        ) VALUES (
            p_idempotency_key,
            'sync-attendance-batch',
            jsonb_build_object('schedule_id', p_schedule_id, 'records_upserted', v_count),
            v_schedule.school_id
        )
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    -- e. Flip teacher_indicator PENDING → HADIR segera setelah absensi disubmit.
    IF v_schedule.session_date = CURRENT_DATE
       AND v_schedule.teacher_indicator = 'PENDING_EVALUATION' THEN
        UPDATE teaching_schedules
        SET    teacher_indicator = 'HADIR'::teacher_attendance_indicator,
               updated_at        = NOW()
        WHERE  schedule_id = p_schedule_id;
    END IF;

    RETURN jsonb_build_object('records_upserted', v_count);

EXCEPTION
    WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'invalid_enum_value: %', SQLERRM
            USING ERRCODE = 'P0005';
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_sync_coaching_case(p_idempotency_key text, p_case_id uuid, p_student_id uuid, p_created_by_user_id uuid, p_track text, p_title text, p_description text, p_initiated_by_role text DEFAULT NULL::text, p_audience text DEFAULT 'PRIVATE'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id UUID;
BEGIN
    SELECT school_id INTO v_school_id
    FROM users
    WHERE user_id = p_created_by_user_id;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'author_not_found: user_id = %', p_created_by_user_id
            USING ERRCODE = 'P0004';
    END IF;

    INSERT INTO coaching_cases (
        case_id, school_id, student_id,
        created_by_user_id, current_handler_user_id,
        track, title, description
    ) VALUES (
        p_case_id, v_school_id, p_student_id,
        p_created_by_user_id, p_created_by_user_id,
        p_track::case_track, p_title, p_description
    )
    ON CONFLICT (case_id) DO NOTHING;

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO sync_idempotency (
            idempotency_key, function_name, result_json, school_id
        ) VALUES (
            p_idempotency_key, 'sync-case',
            jsonb_build_object('case_id', p_case_id),
            v_school_id
        )
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    RETURN jsonb_build_object('case_id', p_case_id);
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_sync_journal(p_idempotency_key text, p_journal_id uuid, p_owner_user_id uuid, p_entry_date date, p_content text, p_schedule_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id UUID;
BEGIN
    -- DEAD GUARD: auth.uid() selalu NULL saat dipanggil via service_role
    -- dari edge function sync-journal. Blok ini tidak pernah dieksekusi.
    -- Proteksi owner dilakukan di edge function (pre-check owner_user_id)
    -- dan di RLS policy rls_journals_owner (FOR ALL, USING + WITH CHECK).
    -- Jangan hapus blok ini — biarkan sebagai dokumentasi intent.
    IF auth.uid() IS NOT NULL
       AND fn_current_user_id() IS DISTINCT FROM p_owner_user_id THEN
        RAISE EXCEPTION 'akses ditolak: pemilik jurnal harus akun yang sedang login'
            USING ERRCODE = '42501';
    END IF;

    -- p_schedule_id dan p_class_id sengaja TIDAK dipakai: kolomnya sudah
    -- dilepas demi isolasi. Parameter dipertahankan demi kompatibilitas
    -- pemanggil (edge function sync-journal, contracts/11_api_contract.js).

    SELECT school_id INTO v_school_id
    FROM users
    WHERE user_id = p_owner_user_id;
    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'owner_not_found: user_id = %', p_owner_user_id
            USING ERRCODE = 'P0004';
    END IF;

    INSERT INTO teacher_journals (
        journal_id, owner_user_id, entry_date, content, school_id
    ) VALUES (
        p_journal_id, p_owner_user_id, p_entry_date, p_content, v_school_id
    )
    ON CONFLICT (journal_id) DO UPDATE SET
        entry_date = EXCLUDED.entry_date,
        content    = EXCLUDED.content,
        updated_at = NOW();

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO sync_idempotency (
            idempotency_key, function_name, result_json, school_id
        ) VALUES (
            p_idempotency_key, 'sync-journal',
            jsonb_build_object('journal_id', p_journal_id),
            v_school_id
        )
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    RETURN jsonb_build_object('journal_id', p_journal_id);
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_sync_observation(p_idempotency_key text, p_observation_id uuid, p_author_user_id uuid, p_student_id uuid, p_sentiment text, p_dimension text, p_visibility text, p_content text, p_observed_at timestamp with time zone, p_schedule_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id UUID;
BEGIN
    IF auth.uid() IS NOT NULL
       AND fn_current_user_id() IS DISTINCT FROM p_author_user_id THEN
        RAISE EXCEPTION 'akses ditolak: penulis harus akun yang sedang login'
            USING ERRCODE = '42501';
    END IF;

    SELECT school_id INTO v_school_id
    FROM users
    WHERE user_id = p_author_user_id;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'author_not_found: user_id = %', p_author_user_id
            USING ERRCODE = 'P0004';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM students
        WHERE student_id = p_student_id AND school_id = v_school_id
    ) THEN
        RAISE EXCEPTION 'student_not_in_school: student_id = %', p_student_id
            USING ERRCODE = 'P0005';
    END IF;

    INSERT INTO observations (
        observation_id, author_user_id, student_id,
        sentiment, dimension, visibility, content, observed_at,
        schedule_id, class_id, school_id
    ) VALUES (
        p_observation_id, p_author_user_id, p_student_id,
        p_sentiment::observation_sentiment,
        p_dimension::observation_dimension,
        p_visibility::visibility_level,
        p_content, p_observed_at,
        p_schedule_id, p_class_id, v_school_id
    )
    ON CONFLICT (observation_id) DO UPDATE SET
        sentiment   = EXCLUDED.sentiment,
        dimension   = EXCLUDED.dimension,
        visibility  = EXCLUDED.visibility,
        content     = EXCLUDED.content,
        observed_at = EXCLUDED.observed_at,
        updated_at  = NOW();

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO sync_idempotency (
            idempotency_key, function_name, result_json, school_id
        ) VALUES (
            p_idempotency_key, 'sync-observation',
            jsonb_build_object('observation_id', p_observation_id),
            v_school_id
        )
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    RETURN jsonb_build_object('observation_id', p_observation_id);
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_teacher_attendance_signal()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_schedule_id UUID;
    v_user_id     UUID;
    v_activity    VARCHAR(50);
BEGIN
    IF TG_TABLE_NAME = 'attendance' THEN
        v_schedule_id := NEW.schedule_id;
        v_user_id     := NEW.recorded_by_user_id;
        v_activity    := 'ATTENDANCE_SUBMITTED';

    ELSIF TG_TABLE_NAME = 'observations' THEN
        -- Observations only signal if linked to a schedule
        IF NEW.schedule_id IS NULL THEN
            RETURN NEW;
        END IF;
        v_schedule_id := NEW.schedule_id;
        v_user_id     := NEW.author_user_id;
        v_activity    := 'OBSERVATION_CREATED';

    ELSIF TG_TABLE_NAME = 'teacher_journals' THEN
        IF NEW.schedule_id IS NULL THEN
            RETURN NEW;
        END IF;
        v_schedule_id := NEW.schedule_id;
        v_user_id     := NEW.owner_user_id;
        v_activity    := 'JOURNAL_ENTRY_CREATED';
    END IF;

    -- Only insert signal if schedule's teacher_indicator is still PENDING
    -- and the session is today (guard against backdated entries changing old indicators)
    INSERT INTO teacher_attendance_log (schedule_id, user_id, activity_type)
    SELECT v_schedule_id, v_user_id, v_activity
    WHERE EXISTS (
        SELECT 1 FROM teaching_schedules
        WHERE schedule_id    = v_schedule_id
          AND session_date   = CURRENT_DATE
          AND teacher_indicator = 'PENDING_EVALUATION'
    )
    ON CONFLICT DO NOTHING;

    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_teaches_class(p_class_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM   teaching_assignments ta
        WHERE  ta.user_id   = fn_current_user_id()
          AND  ta.class_id  = p_class_id
          AND  ta.school_id = fn_current_school_id()
          AND  ta.is_active = true
    );
$function$;
CREATE OR REPLACE FUNCTION public.fn_teaches_student(p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT public.fn_student_in_current_school(p_student_id)
       AND EXISTS (
            SELECT 1
            FROM public.class_enrollments ce
            JOIN public.teaching_assignments ta
              ON ta.class_id = ce.class_id
             AND ta.school_id = ce.school_id
            WHERE ce.student_id = p_student_id
              AND ce.school_id = public.fn_current_school_id()
              AND ta.school_id = public.fn_current_school_id()
              AND ta.user_id = public.fn_current_user_id()
              AND ta.is_active = TRUE
              AND ce.withdrawn_at IS NULL
       );
$function$;
CREATE OR REPLACE FUNCTION public.fn_toggle_forum_post_withdrawn(p_post_id uuid, p_withdrawn boolean)
 RETURNS TABLE(post_id uuid, is_withdrawn boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_caller_id  uuid := public.fn_current_user_id();
    v_author_id  uuid;
    v_moderator  boolean := false;
BEGIN
    IF p_post_id IS NULL OR p_withdrawn IS NULL THEN
        RAISE EXCEPTION 'post_id dan status withdrawn wajib diisi.'
            USING ERRCODE = '22004';
    END IF;

    SELECT fp.author_user_id
    INTO v_author_id
    FROM public.forum_posts fp
    WHERE fp.post_id = p_post_id
      AND fp.school_id = public.fn_current_school_id()
      AND fp.deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Posting tidak ditemukan.'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.user_id = v_caller_id
          AND u.school_id = public.fn_current_school_id()
          AND u.is_active = true
          AND u.deleted_at IS NULL
          AND (
              u.role_type IN ('KEPSEK', 'WAKA_KESISWAAN', 'ADMINISTRATIVE')
              OR u.is_kepsek = true
              OR u.is_waka_kesiswaan = true
          )
    ) INTO v_moderator;

    IF p_withdrawn THEN
        IF v_caller_id IS DISTINCT FROM v_author_id AND NOT v_moderator THEN
            RAISE EXCEPTION 'Akses ditolak: hanya penulis atau moderator yang dapat menarik posting.'
                USING ERRCODE = '42501';
        END IF;
    ELSIF NOT v_moderator THEN
        RAISE EXCEPTION 'Akses ditolak: hanya moderator yang dapat memulihkan posting.'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    UPDATE public.forum_posts fp
    SET is_withdrawn = p_withdrawn,
        updated_at = now()
    WHERE fp.post_id = p_post_id
      AND fp.school_id = public.fn_current_school_id()
      AND fp.deleted_at IS NULL
    RETURNING fp.post_id, fp.is_withdrawn;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_toggle_tp_taught(p_class_id uuid, p_tp_id text, p_is_taught boolean)
 RETURNS TABLE(id uuid, teacher_id uuid, class_id uuid, tp_id text, school_id uuid, is_taught boolean, taught_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
    v_teacher_id uuid := fn_current_user_id();
    v_school_id  uuid := fn_current_school_id();
BEGIN
    IF v_teacher_id IS NULL OR v_school_id IS NULL THEN
        RAISE EXCEPTION 'Sesi tidak ditemukan';
    END IF;

    RETURN QUERY
    INSERT INTO tp_taught_status (teacher_id, class_id, tp_id, school_id, is_taught, taught_at, updated_at)
    VALUES (
        v_teacher_id,
        p_class_id,
        p_tp_id,
        v_school_id,
        p_is_taught,
        CASE WHEN p_is_taught THEN now() ELSE NULL END,
        now()
    )
    ON CONFLICT (teacher_id, class_id, tp_id) DO UPDATE
        SET is_taught  = EXCLUDED.is_taught,
            taught_at  = CASE WHEN EXCLUDED.is_taught THEN now() ELSE NULL END,
            updated_at = now()
    RETURNING
        tp_taught_status.id,
        tp_taught_status.teacher_id,
        tp_taught_status.class_id,
        tp_taught_status.tp_id,
        tp_taught_status.school_id,
        tp_taught_status.is_taught,
        tp_taught_status.taught_at,
        tp_taught_status.updated_at;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_unvoid_session_attendance()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    UPDATE attendance
    SET is_void     = FALSE,
        void_reason = NULL,
        updated_at  = NOW()
    WHERE schedule_id = NEW.schedule_id
      AND is_void     = TRUE
      AND void_reason = 'GURU_TIDAK_HADIR: session voided automatically';
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_update_program(p_program_id uuid, p_code text, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id UUID := fn_current_school_id();
    v_old_code TEXT;
    v_renames JSONB := '[]'::jsonb;
BEGIN
    IF fn_current_user_role() <> 'ADMINISTRATIVE' OR v_school_id IS NULL THEN
        RAISE EXCEPTION 'akses ditolak: hanya ADMINISTRATIVE yang dapat mengubah program'
            USING ERRCODE = '42501';
    END IF;

    SELECT code INTO v_old_code
    FROM programs
    WHERE program_id = p_program_id AND school_id = v_school_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Program tidak ditemukan di sekolah ini';
    END IF;

    IF v_old_code IS DISTINCT FROM p_code THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'from', c.name,
            'to', replace(c.name, v_old_code, p_code)
        )), '[]'::jsonb)
        INTO v_renames
        FROM classes c
        WHERE c.program_id = p_program_id
          AND c.school_id = v_school_id
          AND c.name LIKE '%' || v_old_code || '%';

        UPDATE classes
        SET name = replace(name, v_old_code, p_code), updated_at = NOW()
        WHERE program_id = p_program_id
          AND school_id = v_school_id
          AND name LIKE '%' || v_old_code || '%';
    END IF;

    UPDATE programs
    SET code = p_code, name = p_name, updated_at = NOW()
    WHERE program_id = p_program_id AND school_id = v_school_id;

    RETURN jsonb_build_object('renames', v_renames);
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_update_school_branding(p_name text, p_npsn text, p_address text, p_phone text, p_logo_url text, p_primary_color text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id UUID;
BEGIN
    SELECT u.school_id INTO v_school_id
    FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.role_type = 'ADMINISTRATIVE'
      AND u.is_active IS TRUE
      AND u.deleted_at IS NULL
    LIMIT 1;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'Akses ditolak: hanya ADMINISTRATIVE aktif yang dapat mengubah branding sekolah.';
    END IF;

    IF NULLIF(TRIM(p_primary_color), '') IS NOT NULL
       AND TRIM(p_primary_color) NOT SIMILAR TO '#[0-9A-Fa-f]{6}' THEN
        RAISE EXCEPTION 'Format warna tidak valid. Gunakan format hex #RRGGBB.';
    END IF;

    UPDATE schools
    SET
        name          = COALESCE(NULLIF(TRIM(p_name), ''), name),
        npsn          = NULLIF(TRIM(p_npsn), ''),
        address       = NULLIF(TRIM(p_address), ''),
        phone         = NULLIF(TRIM(p_phone), ''),
        logo_url      = NULLIF(TRIM(p_logo_url), ''),
        primary_color = COALESCE(NULLIF(TRIM(p_primary_color), ''), primary_color)
    WHERE school_id = v_school_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_update_school_branding(p_name text, p_npsn text, p_address text, p_phone text, p_logo_url text, p_primary_color text, p_secondary_color text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id UUID;
    v_primary_color TEXT;
    v_secondary_color TEXT;
BEGIN
    SELECT u.school_id INTO v_school_id
    FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.role_type = 'ADMINISTRATIVE'
      AND u.is_active IS TRUE
      AND u.deleted_at IS NULL
    LIMIT 1;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'Akses ditolak: hanya ADMINISTRATIVE aktif yang dapat mengubah branding sekolah.';
    END IF;

    IF NULLIF(TRIM(p_primary_color), '') IS NOT NULL
       AND TRIM(p_primary_color) NOT SIMILAR TO '#[0-9A-Fa-f]{6}' THEN
        RAISE EXCEPTION 'Format warna primer tidak valid. Gunakan format hex #RRGGBB.';
    END IF;

    IF NULLIF(TRIM(p_secondary_color), '') IS NOT NULL
       AND TRIM(p_secondary_color) NOT SIMILAR TO '#[0-9A-Fa-f]{6}' THEN
        RAISE EXCEPTION 'Format warna sekunder tidak valid. Gunakan format hex #RRGGBB.';
    END IF;

    SELECT COALESCE(NULLIF(TRIM(p_primary_color), ''), s.primary_color, '#1a56db')
      INTO v_primary_color
    FROM schools s
    WHERE s.school_id = v_school_id;

    v_secondary_color := NULLIF(TRIM(p_secondary_color), '');
    IF v_secondary_color IS NULL THEN
        v_secondary_color := '#'
            || lpad(to_hex(floor(get_byte(decode(substr(v_primary_color, 2), 'hex'), 0) * 0.8)::INT), 2, '0')
            || lpad(to_hex(floor(get_byte(decode(substr(v_primary_color, 2), 'hex'), 1) * 0.8)::INT), 2, '0')
            || lpad(to_hex(floor(get_byte(decode(substr(v_primary_color, 2), 'hex'), 2) * 0.8)::INT), 2, '0');
    END IF;

    UPDATE schools
    SET
        name            = COALESCE(NULLIF(TRIM(p_name), ''), name),
        npsn            = NULLIF(TRIM(p_npsn), ''),
        address         = NULLIF(TRIM(p_address), ''),
        phone           = NULLIF(TRIM(p_phone), ''),
        logo_url        = NULLIF(TRIM(p_logo_url), ''),
        primary_color   = COALESCE(NULLIF(TRIM(p_primary_color), ''), primary_color),
        secondary_color = v_secondary_color
    WHERE school_id = v_school_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_validate_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_new_handler_user_id uuid;
    v_target_role         role_type;
    v_actor_role          role_type;
    v_valid_targets CONSTANT role_type[] := ARRAY[
        'GURU'::role_type,
        'BK'::role_type,
        'WALI_KELAS'::role_type,
        'WAKA_KESISWAAN'::role_type,
        'WAKA_KURIKULUM'::role_type,
        'WAKA_HUMAS'::role_type,
        'KEPSEK'::role_type,
        'KAPRODI'::role_type
    ];
BEGIN
    -- Hanya aktif untuk event ESCALATED
    IF NEW.event_type <> 'ESCALATED' THEN
        RETURN NEW;
    END IF;

    -- Ambil dan validasi new_handler_user_id dari payload
    BEGIN
        v_new_handler_user_id := (NEW.payload->>'new_handler_user_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION
            'escalation_guard: payload.new_handler_user_id bukan UUID valid. case_id=%', NEW.case_id
            USING ERRCODE = 'P0001';
    END;

    IF v_new_handler_user_id IS NULL THEN
        RAISE EXCEPTION
            'escalation_guard: payload ESCALATED wajib menyertakan new_handler_user_id. case_id=%', NEW.case_id
            USING ERRCODE = 'P0001';
    END IF;

    -- Resolve peran target dari UUID + validasi di sekolah yang sama
    SELECT u.role_type INTO v_target_role
    FROM users u
    WHERE u.user_id   = v_new_handler_user_id
      AND u.school_id = NEW.school_id
      AND u.is_active = true
      AND u.deleted_at IS NULL;

    IF v_target_role IS NULL THEN
        RAISE EXCEPTION
            'escalation_guard: new_handler_user_id "%" tidak ditemukan sebagai user aktif di sekolah yang sama. case_id=%',
            v_new_handler_user_id, NEW.case_id
            USING ERRCODE = 'P0001';
    END IF;

    -- Validasi peran target ∈ 8 peran internal yang sah
    IF NOT (v_target_role = ANY(v_valid_targets)) THEN
        RAISE EXCEPTION
            'escalation_guard: peran target "%" bukan peran internal yang valid untuk eskalasi. '
            'Peran yang diizinkan: GURU, BK, WALI_KELAS, WAKA_KESISWAAN, WAKA_KURIKULUM, WAKA_HUMAS, KEPSEK, KAPRODI. case_id=%',
            v_target_role, NEW.case_id
            USING ERRCODE = 'P0001';
    END IF;

    -- Resolve peran aktor dari author_user_id
    SELECT u.role_type INTO v_actor_role
    FROM users u
    WHERE u.user_id = NEW.author_user_id;

    -- DUDI hanya boleh eskalasi ke KAPRODI
    IF v_actor_role = 'DUDI'::role_type
       AND v_target_role <> 'KAPRODI'::role_type THEN
        RAISE EXCEPTION
            'escalation_guard: DUDI hanya boleh eskalasi ke KAPRODI, bukan "%". case_id=%',
            v_target_role, NEW.case_id
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_validate_parent_forum_audience()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_author_id     uuid;
    v_school_id     uuid;
    v_academic_year text;
    v_subject_student_ids uuid[];
BEGIN
    SELECT fp.author_user_id, fp.school_id, fp.academic_year
      INTO v_author_id, v_school_id, v_academic_year
    FROM public.forum_posts fp
    WHERE fp.post_id = NEW.post_id;

    SELECT array_agg(fps.student_id)
      INTO v_subject_student_ids
    FROM public.forum_post_subjects fps
    WHERE fps.post_id = NEW.post_id;

    IF v_author_id IS NULL
       OR public.fn_current_user_role() IS DISTINCT FROM 'ORTU'
       OR v_author_id <> public.fn_current_user_id()
       OR NEW.user_id = v_author_id
    THEN
        RETURN NEW;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM (
            SELECT u.user_id
            FROM public.student_parents sp
            JOIN public.class_enrollments ce
              ON ce.student_id = sp.student_id
             AND ce.school_id = v_school_id
             AND ce.academic_year = v_academic_year
             AND ce.withdrawn_at IS NULL
            JOIN public.users u
              ON u.school_id = v_school_id
             AND u.wali_kelas_class_id = ce.class_id
             AND u.is_active IS TRUE
             AND u.deleted_at IS NULL
            WHERE sp.parent_user_id = v_author_id
              AND sp.school_id = v_school_id
              AND (v_subject_student_ids IS NULL OR sp.student_id = ANY(v_subject_student_ids))

            UNION

            SELECT bca.bk_user_id
            FROM public.student_parents sp
            JOIN public.class_enrollments ce
              ON ce.student_id = sp.student_id
             AND ce.school_id = v_school_id
             AND ce.academic_year = v_academic_year
             AND ce.withdrawn_at IS NULL
            JOIN public.bk_class_assignments bca
              ON bca.class_id = ce.class_id
             AND bca.school_id = v_school_id
             AND bca.is_active IS TRUE
            JOIN public.users u
              ON u.user_id = bca.bk_user_id
             AND u.school_id = v_school_id
             AND u.is_active IS TRUE
             AND u.deleted_at IS NULL
            WHERE sp.parent_user_id = v_author_id
              AND sp.school_id = v_school_id
              AND (v_subject_student_ids IS NULL OR sp.student_id = ANY(v_subject_student_ids))

            UNION

            SELECT gwa.guru_user_id
            FROM public.student_parents sp
            JOIN public.guru_wali_assignments gwa
              ON gwa.student_id = sp.student_id
             AND gwa.school_id = v_school_id
             AND gwa.academic_year = v_academic_year
             AND gwa.is_active IS TRUE
            JOIN public.users u
              ON u.user_id = gwa.guru_user_id
             AND u.school_id = v_school_id
             AND u.is_active IS TRUE
             AND u.deleted_at IS NULL
            WHERE sp.parent_user_id = v_author_id
              AND sp.school_id = v_school_id
              AND (v_subject_student_ids IS NULL OR sp.student_id = ANY(v_subject_student_ids))

            UNION

            SELECT ts.scheduled_teacher_id
            FROM public.student_parents sp
            JOIN public.class_enrollments ce
              ON ce.student_id = sp.student_id
             AND ce.school_id = v_school_id
             AND ce.academic_year = v_academic_year
             AND ce.withdrawn_at IS NULL
            JOIN public.teaching_schedules ts
              ON ts.class_id = ce.class_id
             AND ts.school_id = v_school_id
             AND ts.session_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date
            JOIN public.users u
              ON u.user_id = ts.scheduled_teacher_id
             AND u.school_id = v_school_id
             AND u.is_active IS TRUE
             AND u.deleted_at IS NULL
            WHERE sp.parent_user_id = v_author_id
              AND sp.school_id = v_school_id
              AND (v_subject_student_ids IS NULL OR sp.student_id = ANY(v_subject_student_ids))
        ) allowed
        WHERE allowed.user_id = NEW.user_id
    ) THEN
        RAISE EXCEPTION 'Penerima forum orang tua tidak terkait dengan anak pengirim.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_validate_student_parent_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_parent_role       role_type;
    v_parent_school_id  uuid;
    v_student_school_id uuid;
BEGIN
    IF NEW.school_id IS NULL THEN
        RAISE EXCEPTION 'student_parents_tenant_guard: school_id wajib diisi'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT u.role_type, u.school_id
      INTO v_parent_role, v_parent_school_id
    FROM public.users u
    WHERE u.user_id = NEW.parent_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'student_parents_tenant_guard: parent_user_id % tidak ditemukan di public.users', NEW.parent_user_id
            USING ERRCODE = 'P0001';
    END IF;

    IF v_parent_role IS DISTINCT FROM 'ORTU'::role_type THEN
        RAISE EXCEPTION
            'student_parents_tenant_guard: parent_user_id % harus memiliki role_type ORTU, ditemukan %',
            NEW.parent_user_id, v_parent_role
            USING ERRCODE = 'P0001';
    END IF;

    IF v_parent_school_id IS DISTINCT FROM NEW.school_id THEN
        RAISE EXCEPTION
            'student_parents_tenant_guard: school_id parent (%) tidak sama dengan school_id relasi (%)',
            v_parent_school_id, NEW.school_id
            USING ERRCODE = 'P0001';
    END IF;

    SELECT s.school_id
      INTO v_student_school_id
    FROM public.students s
    WHERE s.student_id = NEW.student_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'student_parents_tenant_guard: student_id % tidak ditemukan di public.students', NEW.student_id
            USING ERRCODE = 'P0001';
    END IF;

    IF v_student_school_id IS DISTINCT FROM NEW.school_id THEN
        RAISE EXCEPTION
            'student_parents_tenant_guard: school_id siswa (%) tidak sama dengan school_id relasi (%)',
            v_student_school_id, NEW.school_id
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_void_session_attendance()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Fires when meeting_status transitions to GURU_TIDAK_HADIR
    IF NEW.meeting_status = 'GURU_TIDAK_HADIR'
       AND OLD.meeting_status IS DISTINCT FROM 'GURU_TIDAK_HADIR' THEN

        UPDATE attendance
        SET is_void     = TRUE,
            void_reason = 'GURU_TIDAK_HADIR: session voided automatically',
            updated_at  = NOW()
        WHERE schedule_id = NEW.schedule_id
          AND is_void     = FALSE;

    END IF;
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_waka_approve_doc(p_doc_id uuid, p_action character varying, p_catatan text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_school_id       UUID;
  v_new_status      VARCHAR(30);
  v_kepsek_user_id  UUID;
BEGIN
  IF NOT public.fn_is_waka_kurikulum() THEN
    RAISE EXCEPTION 'Akses ditolak: hanya Waka Kurikulum';
  END IF;

  SELECT school_id INTO v_school_id
  FROM public.teacher_documents
  WHERE doc_id = p_doc_id
    AND school_id = public.fn_current_school_id()
    AND status = 'MENUNGGU_WAKA'
    AND teacher_user_id != auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dokumen tidak ditemukan, status tidak valid, atau tidak boleh menyetujui dokumen sendiri';
  END IF;

  IF p_action = 'APPROVE' THEN
    v_new_status := 'DISAHKAN_WAKA';
  ELSIF p_action = 'REJECT' THEN
    v_new_status := 'DIREVIEW_GURU';
  ELSE
    RAISE EXCEPTION 'Action tidak valid';
  END IF;

  UPDATE public.teacher_documents
  SET status = v_new_status, updated_at = now()
  WHERE doc_id = p_doc_id;

  INSERT INTO public.teacher_document_approvals
    (doc_id, school_id, approved_by, status, catatan)
  VALUES (
    p_doc_id,
    v_school_id,
    auth.uid(),
    CASE WHEN p_action = 'APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END,
    p_catatan
  )
  ON CONFLICT (doc_id, status) DO NOTHING;

  -- Notifikasi ke Kepsek setelah disahkan
  IF p_action = 'APPROVE' THEN
    SELECT u.user_id INTO v_kepsek_user_id
    FROM public.users u
    WHERE u.school_id = v_school_id
      AND u.is_kepsek = true
    LIMIT 1;

    IF v_kepsek_user_id IS NOT NULL THEN
      INSERT INTO public.notifications
        (recipient_user_id, school_id, type, title, body)
      VALUES (
        v_kepsek_user_id,
        v_school_id,
        'PERANGKAT_AJAR',
        'Perangkat Ajar Disahkan',
        'Waka Kurikulum telah mengesahkan perangkat ajar.'
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_waka_kur_stats(p_date_start date DEFAULT NULL::date, p_date_end date DEFAULT NULL::date)
 RETURNS TABLE(guru_hadir bigint, guru_total bigint, guru_belum bigint, pct_hadir numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id uuid;
BEGIN
    SELECT u.school_id INTO v_school_id
    FROM public.users u
    WHERE u.auth_user_id = auth.uid() AND u.is_active
      AND (u.role_type IN ('WAKA_KURIKULUM', 'KEPSEK', 'ADMINISTRATIVE')
           OR u.is_waka_kurikulum OR u.is_kepsek)
    LIMIT 1;
    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'Akses monitoring kurikulum ditolak' USING ERRCODE = '42501';
    END IF;
    IF p_date_start > p_date_end THEN
        RAISE EXCEPTION 'Tanggal awal tidak boleh melewati tanggal akhir' USING ERRCODE = '22007';
    END IF;

    RETURN QUERY
    WITH sessions AS (
        SELECT ts.scheduled_teacher_id,
            EXISTS (
                SELECT 1 FROM public.attendance a
                WHERE a.schedule_id = ts.schedule_id AND NOT a.is_void
            ) AS filled
        FROM public.teaching_schedules ts
        WHERE ts.school_id = v_school_id
          AND ts.meeting_status = 'NORMAL'
          AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
          AND (p_date_end IS NULL OR ts.session_date <= p_date_end)
    ), teachers AS (
        SELECT s.scheduled_teacher_id, bool_or(s.filled) AS started,
            bool_or(NOT s.filled) AS pending
        FROM sessions s
        WHERE s.scheduled_teacher_id IS NOT NULL
        GROUP BY s.scheduled_teacher_id
    )
    SELECT count(*) FILTER (WHERE t.started), count(*),
        count(*) FILTER (WHERE t.pending),
        round(100.0 * count(*) FILTER (WHERE t.started) / nullif(count(*), 0), 1)
    FROM teachers t;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_wali_attendance_sessions(p_class_id uuid, p_academic_year text, p_student_id uuid, p_date_start date DEFAULT NULL::date, p_date_end date DEFAULT NULL::date)
 RETURNS TABLE(attendance_id uuid, status attendance_status, notes text, session_date date, session_start time without time zone, session_end time without time zone, subject_label text, teacher_full_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users u
        JOIN public.classes c ON c.class_id = u.wali_kelas_class_id AND c.school_id = u.school_id
        WHERE u.auth_user_id = auth.uid()
          AND u.school_id = public.fn_current_school_id()
          AND u.is_active
          AND u.wali_kelas_class_id = p_class_id
          AND u.role_type IN ('GURU','WALI_KELAS','BK','KAPRODI','KEPSEK',
                              'WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS')
    ) THEN
        RAISE EXCEPTION 'Tidak berwenang membaca detail absensi kelas ini' USING ERRCODE = '42501';
    END IF;
    IF p_date_start > p_date_end THEN
        RAISE EXCEPTION 'Rentang tanggal tidak valid' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT a.attendance_id, a.status, a.notes,
        ts.session_date, ts.session_start, ts.session_end,
        ts.subject_label::TEXT, teacher.full_name::TEXT
    FROM public.attendance a
    JOIN public.teaching_schedules ts ON ts.schedule_id = a.schedule_id
    JOIN public.students s ON s.student_id = a.student_id
    LEFT JOIN public.users teacher
        ON teacher.user_id = ts.scheduled_teacher_id AND teacher.school_id = ts.school_id
    WHERE ts.class_id = p_class_id
      AND ts.school_id = public.fn_current_school_id()
      AND ts.academic_year = p_academic_year
      AND a.student_id = p_student_id
      AND a.school_id = public.fn_current_school_id()
      AND NOT a.is_void
      AND s.school_id = public.fn_current_school_id()
      AND s.student_status = 'AKTIF'
      AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
      AND (p_date_end IS NULL OR ts.session_date <= p_date_end)
      AND EXISTS (
          SELECT 1 FROM public.class_enrollments ce
          WHERE ce.student_id = s.student_id
            AND ce.class_id = p_class_id
            AND ce.school_id = public.fn_current_school_id()
            AND ce.academic_year = p_academic_year
            AND ce.withdrawn_at IS NULL
      )
    ORDER BY ts.session_date DESC, ts.session_start, a.attendance_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_wali_kelas_class_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT wali_kelas_class_id FROM users WHERE auth_user_id = auth.uid();
$function$;
CREATE OR REPLACE FUNCTION public.fn_wali_of_student(p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT public.fn_student_in_current_school(p_student_id)
       AND public.fn_wali_kelas_class_id() IS NOT NULL
       AND EXISTS (
            SELECT 1
            FROM public.class_enrollments ce
            WHERE ce.student_id = p_student_id
              AND ce.school_id = public.fn_current_school_id()
              AND ce.class_id = public.fn_wali_kelas_class_id()
              AND ce.withdrawn_at IS NULL
       );
$function$;
CREATE OR REPLACE FUNCTION public.fn_wizard_reset_schedules(p_school_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_schedule_ids  uuid[];
    v_deleted_sched int;
    v_deleted_tpl   int;
    v_deleted_asgn  int;
BEGIN
    -- Verifikasi pemanggil adalah ADMINISTRATIVE sekolah ini
    IF fn_current_school_id() <> p_school_id THEN
        RAISE EXCEPTION 'Akses ditolak: bukan sekolah Anda.';
    END IF;
    IF fn_current_user_role() <> 'ADMINISTRATIVE' THEN
        RAISE EXCEPTION 'Akses ditolak: hanya ADMINISTRATIVE yang dapat mereset jadwal.';
    END IF;

    -- Kumpulkan schedule_ids untuk hapus data yang RESTRICT ke teaching_schedules
    SELECT ARRAY_AGG(schedule_id) INTO v_schedule_ids
    FROM teaching_schedules WHERE school_id = p_school_id;

    IF v_schedule_ids IS NOT NULL AND array_length(v_schedule_ids, 1) > 0 THEN
        -- Log aktivitas guru per sesi (NOT NULL FK — penyebab utama 409)
        DELETE FROM teacher_attendance_log
        WHERE schedule_id = ANY(v_schedule_ids);

        -- Jurnal guru yang terkait sesi jadwal (nullable FK)
        DELETE FROM teacher_journals
        WHERE schedule_id = ANY(v_schedule_ids);

        -- Absensi yang terkait sesi jadwal
        DELETE FROM attendance
        WHERE schedule_id = ANY(v_schedule_ids);

        -- Jadwal guru pengganti
        DELETE FROM substitute_schedules
        WHERE schedule_id = ANY(v_schedule_ids);

        -- Observasi yang terkait sesi jadwal
        DELETE FROM observations
        WHERE schedule_id = ANY(v_schedule_ids) AND school_id = p_school_id;
    END IF;

    -- Sesi jadwal konkret
    DELETE FROM teaching_schedules WHERE school_id = p_school_id;
    GET DIAGNOSTICS v_deleted_sched = ROW_COUNT;

    -- Template jadwal mingguan
    DELETE FROM schedule_templates WHERE school_id = p_school_id;
    GET DIAGNOSTICS v_deleted_tpl = ROW_COUNT;

    -- Penugasan mengajar
    DELETE FROM teaching_assignments WHERE school_id = p_school_id;
    GET DIAGNOSTICS v_deleted_asgn = ROW_COUNT;

    RETURN jsonb_build_object(
        'deleted_schedules',         v_deleted_sched,
        'deleted_templates',         v_deleted_tpl,
        'deleted_assignments',       v_deleted_asgn
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_wizard_reset_students(p_school_id uuid, p_student_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_ids           uuid[];
    v_case_ids      uuid[];
    v_user_ids      uuid[];
    v_auth_ids      uuid[];
    v_deleted_count int;
BEGIN
    IF fn_current_school_id() <> p_school_id THEN
        RAISE EXCEPTION 'Akses ditolak: bukan sekolah Anda.';
    END IF;
    IF fn_current_user_role() <> 'ADMINISTRATIVE' THEN
        RAISE EXCEPTION 'Akses ditolak: hanya ADMINISTRATIVE yang dapat mereset data siswa.';
    END IF;

    IF p_student_ids IS NULL THEN
        SELECT ARRAY_AGG(student_id) INTO v_ids
        FROM students WHERE school_id = p_school_id;
    ELSE
        SELECT ARRAY_AGG(student_id) INTO v_ids
        FROM students
        WHERE student_id = ANY(p_student_ids) AND school_id = p_school_id;
    END IF;

    IF v_ids IS NULL OR array_length(v_ids, 1) = 0 THEN
        RETURN jsonb_build_object('deleted_students', 0, 'auth_user_ids', '[]'::jsonb);
    END IF;

    SELECT ARRAY_AGG(case_id) INTO v_case_ids
    FROM coaching_cases WHERE student_id = ANY(v_ids) AND school_id = p_school_id;

    SELECT ARRAY_AGG(user_id) INTO v_user_ids
    FROM students WHERE student_id = ANY(v_ids) AND user_id IS NOT NULL;

    IF v_user_ids IS NOT NULL AND array_length(v_user_ids, 1) > 0 THEN
        SELECT ARRAY_AGG(auth_user_id) INTO v_auth_ids
        FROM users WHERE user_id = ANY(v_user_ids) AND auth_user_id IS NOT NULL;
    END IF;

    -- student_updates via case_id
    IF v_case_ids IS NOT NULL AND array_length(v_case_ids, 1) > 0 THEN
        DELETE FROM student_updates WHERE case_id = ANY(v_case_ids);
    END IF;

    -- coaching_case_events (append-only, disable trigger sementara)
    ALTER TABLE coaching_case_events DISABLE TRIGGER trg_coaching_case_events_immutable;
    IF v_case_ids IS NOT NULL AND array_length(v_case_ids, 1) > 0 THEN
        DELETE FROM coaching_case_events WHERE case_id = ANY(v_case_ids);
    END IF;
    ALTER TABLE coaching_case_events ENABLE TRIGGER trg_coaching_case_events_immutable;

    DELETE FROM coaching_cases
    WHERE student_id = ANY(v_ids) AND school_id = p_school_id;

    DELETE FROM attendance
    WHERE student_id = ANY(v_ids) AND school_id = p_school_id;

    DELETE FROM observations
    WHERE student_id = ANY(v_ids) AND school_id = p_school_id;

    DELETE FROM pkl_attendance
    WHERE student_id = ANY(v_ids);

    DELETE FROM pkl_placements
    WHERE student_id = ANY(v_ids) AND school_id = p_school_id;

    DELETE FROM guru_wali_assignments
    WHERE student_id = ANY(v_ids) AND school_id = p_school_id;

    DELETE FROM class_enrollments
    WHERE student_id = ANY(v_ids);

    DELETE FROM student_parents
    WHERE student_id = ANY(v_ids);

    -- Posting forum siswa (RESTRICT ke users)
    IF v_user_ids IS NOT NULL THEN
        DELETE FROM forum_posts
        WHERE author_user_id = ANY(v_user_ids);
    END IF;

    -- Notifications siswa (NO ACTION ke users — hapus sebelum users)
    IF v_user_ids IS NOT NULL THEN
        DELETE FROM notifications
        WHERE recipient_user_id = ANY(v_user_ids);
    END IF;

    -- Akun portal siswa
    IF v_user_ids IS NOT NULL THEN
        DELETE FROM users WHERE user_id = ANY(v_user_ids) AND school_id = p_school_id;
    END IF;

    DELETE FROM students WHERE student_id = ANY(v_ids) AND school_id = p_school_id;
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'deleted_students', v_deleted_count,
        'auth_user_ids',    COALESCE(to_jsonb(v_auth_ids), '[]'::jsonb)
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.trg_close_enrollment_on_graduation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NEW.student_status = 'LULUS'
       AND OLD.student_status IS DISTINCT FROM 'LULUS' THEN
        UPDATE class_enrollments ce
        SET withdrawn_at = GREATEST(COALESCE(NEW.graduated_at, NOW()),
                                    ce.enrolled_at + INTERVAL '1 second'),
            updated_at   = NOW()
        WHERE ce.student_id = NEW.student_id
          AND ce.withdrawn_at IS NULL;
    END IF;
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.trg_pkl_attendance_student_match()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_student_id uuid;
    v_school_id uuid;
BEGIN
    SELECT pp.student_id, pp.school_id INTO v_student_id, v_school_id
    FROM public.pkl_placements pp
    JOIN public.students s ON s.student_id = pp.student_id AND s.school_id = pp.school_id
    WHERE pp.placement_id = NEW.placement_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Penempatan PKL tidak ditemukan.' USING ERRCODE = '23503';
    END IF;
    IF NEW.student_id IS DISTINCT FROM v_student_id OR NEW.school_id IS DISTINCT FROM v_school_id THEN
        RAISE EXCEPTION 'Siswa atau sekolah tidak cocok dengan penempatan PKL.' USING ERRCODE = '23514';
    END IF;
    IF public.fn_current_user_role() = 'DUDI' THEN
        IF NOT public.fn_dudi_can_record_attendance(NEW.placement_id, NEW.student_id, NEW.attendance_date) THEN
            RAISE EXCEPTION 'Absensi hanya untuk penempatan aktif milik Anda, dalam periode PKL, dan bukan tanggal mendatang.'
                USING ERRCODE = '42501';
        END IF;
        IF TG_OP = 'UPDATE' AND (NEW.placement_id, NEW.student_id, NEW.school_id, NEW.attendance_date)
            IS DISTINCT FROM (OLD.placement_id, OLD.student_id, OLD.school_id, OLD.attendance_date) THEN
            RAISE EXCEPTION 'Identitas absensi PKL tidak dapat dipindahkan.' USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.trg_substitute_not_original()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.substitute_user_id = (
        SELECT scheduled_teacher_id FROM teaching_schedules WHERE schedule_id = NEW.schedule_id
    ) THEN
        RAISE EXCEPTION 'substitute_user_id cannot match the original scheduled teacher';
    END IF;
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.trg_sync_student_name_to_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_target_school_id uuid;
BEGIN
    IF NEW.full_name IS DISTINCT FROM OLD.full_name
       AND NEW.user_id IS NOT NULL THEN
        SELECT u.school_id
        INTO v_target_school_id
        FROM public.users u
        WHERE u.user_id = NEW.user_id;

        -- A missing target produces no UPDATE; the students.user_id FK normally
        -- makes this branch unreachable, but retaining the no-op is retry-safe.
        IF NOT FOUND THEN
            RETURN NEW;
        END IF;

        IF v_target_school_id IS DISTINCT FROM NEW.school_id THEN
            RAISE EXCEPTION
                'student_name_sync_tenant_mismatch: student % school_id % does not match user % school_id %',
                NEW.student_id, NEW.school_id, NEW.user_id, v_target_school_id
                USING ERRCODE = 'P0001';
        END IF;

        UPDATE public.users
        SET full_name = NEW.full_name,
            updated_at = NOW()
        WHERE user_id = NEW.user_id
          AND school_id = NEW.school_id
          AND full_name IS DISTINCT FROM NEW.full_name;
    END IF;
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.trg_sync_user_name_to_student()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_target_school_id uuid;
BEGIN
    IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
        SELECT s.school_id
        INTO v_target_school_id
        FROM public.students s
        WHERE s.user_id = NEW.user_id;

        -- Most users are not students, so an absent target is an intentional no-op.
        IF NOT FOUND THEN
            RETURN NEW;
        END IF;

        IF v_target_school_id IS DISTINCT FROM NEW.school_id THEN
            RAISE EXCEPTION
                'user_name_sync_tenant_mismatch: user % school_id % does not match student target school_id %',
                NEW.user_id, NEW.school_id, v_target_school_id
                USING ERRCODE = 'P0001';
        END IF;

        UPDATE public.students
        SET full_name = NEW.full_name,
            updated_at = NOW()
        WHERE user_id = NEW.user_id
          AND school_id = NEW.school_id
          AND full_name IS DISTINCT FROM NEW.full_name;
    END IF;
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.update_ld_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$;

-- ============================================================
-- Default kolom yang bergantung pada fungsi
-- ============================================================

-- ============================================================
-- View
-- ============================================================
CREATE OR REPLACE VIEW public.v_student_portal_positif WITH (security_invoker=true) AS
 SELECT o.observation_id,
    o.student_id,
    o.dimension,
    o.content,
    o.observed_at,
    u.full_name AS author_name,
    u.role_type AS author_role
   FROM observations o
     JOIN users u ON u.user_id = o.author_user_id
  WHERE o.sentiment = 'POSITIF'::observation_sentiment AND o.visibility = 'STUDENT_VISIBLE'::visibility_level
  ORDER BY o.observed_at DESC;
CREATE OR REPLACE VIEW public.v_attendance_daily_summary WITH (security_invoker=true) AS
 SELECT ts.schedule_id,
    ts.session_date,
    ts.class_id,
    c.name AS class_name,
    ts.scheduled_teacher_id,
    u.full_name AS teacher_name,
    ts.meeting_status,
    ts.teacher_indicator,
    count(a.attendance_id) FILTER (WHERE a.is_void = false) AS total_students,
    count(a.attendance_id) FILTER (WHERE a.status = 'HADIR'::attendance_status AND a.is_void = false) AS hadir,
    count(a.attendance_id) FILTER (WHERE a.status = 'ALPA'::attendance_status AND a.is_void = false) AS tidak_hadir,
    count(a.attendance_id) FILTER (WHERE a.status = 'IZIN'::attendance_status AND a.is_void = false) AS izin,
    count(a.attendance_id) FILTER (WHERE a.status = 'SAKIT'::attendance_status AND a.is_void = false) AS sakit,
    round(count(a.attendance_id) FILTER (WHERE a.status = 'HADIR'::attendance_status AND a.is_void = false)::numeric / NULLIF(count(a.attendance_id) FILTER (WHERE a.is_void = false), 0)::numeric * 100::numeric, 1) AS hadir_pct
   FROM teaching_schedules ts
     JOIN classes c ON c.class_id = ts.class_id
     JOIN users u ON u.user_id = ts.scheduled_teacher_id
     LEFT JOIN attendance a ON a.schedule_id = ts.schedule_id
  GROUP BY ts.schedule_id, ts.session_date, ts.class_id, c.name, ts.scheduled_teacher_id, u.full_name, ts.meeting_status, ts.teacher_indicator;
CREATE OR REPLACE VIEW public.v_offline_sync_manifest_guru WITH (security_invoker=true) AS
 SELECT ts.schedule_id,
    ts.session_date,
    ts.session_start,
    ts.session_end,
    ts.class_id,
    c.name AS class_name,
    ts.subject_id,
    s.name AS subject_name,
    ts.scheduled_teacher_id,
    ts.meeting_status,
    json_agg(json_build_object('student_id', st.student_id, 'nis', st.nis, 'full_name', st.full_name, 'att_status', COALESCE(a.status, 'HADIR'::attendance_status), 'att_source', COALESCE(a.source::text, 'AUTO_DETECTED'::text), 'att_id', a.attendance_id) ORDER BY st.full_name) AS students_json
   FROM teaching_schedules ts
     JOIN classes c ON c.class_id = ts.class_id
     JOIN subjects s ON s.subject_id = ts.subject_id
     JOIN class_enrollments ce ON ce.class_id = ts.class_id AND ce.academic_year::text = ts.academic_year::text AND ce.semester = ts.semester AND ce.withdrawn_at IS NULL
     JOIN students st ON st.student_id = ce.student_id AND st.student_status = 'AKTIF'::student_status
     LEFT JOIN attendance a ON a.schedule_id = ts.schedule_id AND a.student_id = st.student_id AND a.is_void = false
  WHERE ts.session_date >= CURRENT_DATE AND ts.session_date <= (CURRENT_DATE + '7 days'::interval)
  GROUP BY ts.schedule_id, ts.session_date, ts.session_start, ts.session_end, ts.class_id, c.name, ts.subject_id, s.name, ts.scheduled_teacher_id, ts.meeting_status;
CREATE OR REPLACE VIEW public.v_offline_sync_manifest_substitute WITH (security_invoker=true) AS
 SELECT ts.schedule_id,
    ts.session_date,
    ts.session_start,
    ts.session_end,
    ts.class_id,
    c.name AS class_name,
    ts.subject_id,
    s.name AS subject_name,
    ss.substitute_user_id,
    ss.sync_token,
    ss.sync_token_expires_at,
    ts.meeting_status,
    json_agg(json_build_object('student_id', st.student_id, 'nis', st.nis, 'full_name', st.full_name, 'att_status', COALESCE(a.status, 'HADIR'::attendance_status), 'att_source', COALESCE(a.source::text, 'AUTO_DETECTED'::text), 'att_id', a.attendance_id) ORDER BY st.full_name) AS students_json
   FROM substitute_schedules ss
     JOIN teaching_schedules ts ON ts.schedule_id = ss.schedule_id
     JOIN classes c ON c.class_id = ts.class_id
     JOIN subjects s ON s.subject_id = ts.subject_id
     JOIN class_enrollments ce ON ce.class_id = ts.class_id AND ce.academic_year::text = ts.academic_year::text AND ce.semester = ts.semester AND ce.withdrawn_at IS NULL
     JOIN students st ON st.student_id = ce.student_id AND st.student_status = 'AKTIF'::student_status
     LEFT JOIN attendance a ON a.schedule_id = ts.schedule_id AND a.student_id = st.student_id AND a.is_void = false
  WHERE ss.sync_token_expires_at > now()
  GROUP BY ts.schedule_id, ts.session_date, ts.session_start, ts.session_end, ts.class_id, c.name, ts.subject_id, s.name, ss.substitute_user_id, ss.sync_token, ss.sync_token_expires_at, ts.meeting_status;
CREATE OR REPLACE VIEW public.v_academic_year_drift WITH (security_invoker=true) AS
 SELECT sc.school_id,
    sc.current_academic_year AS config_year,
    ap.academic_year AS active_period_year,
    sc.current_academic_year::text IS DISTINCT FROM ap.academic_year::text AS config_vs_period_drift,
    ( SELECT count(*) AS count
           FROM classes c
          WHERE c.school_id = sc.school_id AND c.is_active = true AND c.academic_year::text IS DISTINCT FROM ap.academic_year::text) AS active_classes_lagging
   FROM school_config sc
     LEFT JOIN LATERAL ( SELECT p.academic_year
           FROM academic_periods p
          WHERE p.school_id = sc.school_id AND p.status::text = 'ACTIVE'::text
          ORDER BY p.start_date DESC
         LIMIT 1) ap ON true;
CREATE OR REPLACE VIEW public.v_users_staff_directory WITH (security_invoker=true) AS
 SELECT user_id,
    school_id,
    full_name,
    role_type,
    dudi_org_name,
    teacher_code,
    program_id,
    is_active,
    allow_parallel_teaching,
    login_identifier,
    deleted_at
   FROM users;
CREATE OR REPLACE VIEW public.v_core_subjects WITH (security_invoker=true) AS
 SELECT subject_id,
    code,
    name,
    subject_type,
    is_generatable
   FROM core.subjects
  ORDER BY subject_type, name;
CREATE OR REPLACE VIEW public.v_cp_for_generate WITH (security_invoker=true) AS
 SELECT sp.subject_id AS core_subject_id,
    sp.phase_id,
    p.code AS fase_code,
    s.name AS subject_name,
    s.code AS subject_code,
    s.subject_type,
    cp.cp_umum,
    cp.rasional,
    cp.tujuan,
    cp.karakteristik,
    COALESCE(json_agg(json_build_object('urutan', e.element_order, 'nama', e.nama_elemen, 'deskripsi', e.deskripsi_cp) ORDER BY e.element_order) FILTER (WHERE e.element_id IS NOT NULL AND e.is_active = true), '[]'::json) AS elemen
   FROM core.subject_phases sp
     JOIN core.phases p ON p.phase_id = sp.phase_id
     JOIN core.subjects s ON s.subject_id = sp.subject_id
     JOIN core.capaian_pembelajaran cp ON cp.subject_phase_id = sp.subject_phase_id
     LEFT JOIN core.cp_elements e ON e.cp_id = cp.cp_id
  WHERE s.is_active = true
  GROUP BY sp.subject_id, sp.phase_id, p.code, s.name, s.code, s.subject_type, cp.cp_umum, cp.rasional, cp.tujuan, cp.karakteristik;

-- ============================================================
-- Trigger
-- ============================================================
CREATE OR REPLACE TRIGGER trg_auto_school_id BEFORE INSERT ON academic_periods FOR EACH ROW EXECUTE FUNCTION fn_auto_set_school_id();
CREATE OR REPLACE TRIGGER trg_set_updated_at_academic_periods BEFORE UPDATE ON academic_periods FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE OR REPLACE TRIGGER trg_attendance_period_lock BEFORE INSERT OR UPDATE ON attendance FOR EACH ROW EXECUTE FUNCTION fn_attendance_period_lock();
CREATE OR REPLACE TRIGGER trg_auto_recorded_by BEFORE INSERT ON attendance FOR EACH ROW EXECUTE FUNCTION fn_auto_set_recorded_by();
CREATE OR REPLACE TRIGGER trg_auto_school_id BEFORE INSERT ON attendance FOR EACH ROW EXECUTE FUNCTION fn_auto_set_school_id();
CREATE OR REPLACE TRIGGER trg_set_updated_at_attendance BEFORE UPDATE ON attendance FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE OR REPLACE TRIGGER trg_teacher_signal_attendance AFTER INSERT ON attendance FOR EACH ROW EXECUTE FUNCTION fn_teacher_attendance_signal();
CREATE OR REPLACE TRIGGER trg_auto_school_id BEFORE INSERT ON bk_class_assignments FOR EACH ROW EXECUTE FUNCTION fn_auto_set_school_id();
CREATE OR REPLACE TRIGGER trg_forum_assignment_tenant BEFORE INSERT OR UPDATE ON bk_class_assignments FOR EACH ROW EXECUTE FUNCTION fn_guard_forum_assignment_tenant();
CREATE OR REPLACE TRIGGER trg_auto_school_id BEFORE INSERT ON class_enrollments FOR EACH ROW EXECUTE FUNCTION fn_auto_set_school_id();
CREATE OR REPLACE TRIGGER trg_set_updated_at_class_enrollments BEFORE UPDATE ON class_enrollments FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE OR REPLACE TRIGGER trg_auto_school_id BEFORE INSERT ON classes FOR EACH ROW EXECUTE FUNCTION fn_auto_set_school_id();
CREATE OR REPLACE TRIGGER trg_set_updated_at_classes BEFORE UPDATE ON classes FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE OR REPLACE TRIGGER trg_coaching_case_events_immutable BEFORE DELETE OR UPDATE ON coaching_case_events FOR EACH ROW EXECUTE FUNCTION fn_coaching_case_events_immutable();
CREATE OR REPLACE TRIGGER trg_coaching_case_events_no_closed BEFORE INSERT ON coaching_case_events FOR EACH ROW EXECUTE FUNCTION fn_coaching_case_events_no_closed();
CREATE OR REPLACE TRIGGER trg_coaching_case_sync_handler AFTER INSERT ON coaching_case_events FOR EACH ROW EXECUTE FUNCTION fn_coaching_case_sync_handler();
CREATE OR REPLACE TRIGGER trg_validate_escalation BEFORE INSERT ON coaching_case_events FOR EACH ROW EXECUTE FUNCTION fn_validate_escalation();
CREATE OR REPLACE TRIGGER trg_coaching_case_audit_delete BEFORE DELETE ON coaching_cases FOR EACH ROW EXECUTE FUNCTION fn_coaching_case_audit_delete();
CREATE OR REPLACE TRIGGER trg_coaching_case_guard BEFORE UPDATE ON coaching_cases FOR EACH ROW EXECUTE FUNCTION fn_coaching_case_guard();
CREATE OR REPLACE TRIGGER trg_coaching_case_immutable_creator BEFORE UPDATE ON coaching_cases FOR EACH ROW EXECUTE FUNCTION fn_coaching_case_immutable_creator();
CREATE OR REPLACE TRIGGER trg_coaching_case_log_create AFTER INSERT ON coaching_cases FOR EACH ROW EXECUTE FUNCTION fn_coaching_case_log_create();
CREATE OR REPLACE TRIGGER trg_forum_assignment_tenant BEFORE INSERT OR UPDATE ON duty_schedules FOR EACH ROW EXECUTE FUNCTION fn_guard_forum_assignment_tenant();
CREATE OR REPLACE TRIGGER trg_validate_parent_forum_audience BEFORE INSERT ON forum_post_audience FOR EACH ROW EXECUTE FUNCTION fn_validate_parent_forum_audience();
CREATE OR REPLACE TRIGGER trg_forum_post_comments_updated_at BEFORE UPDATE ON forum_post_comments FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE OR REPLACE TRIGGER trg_notify_forum_comment AFTER INSERT ON forum_post_comments FOR EACH ROW EXECUTE FUNCTION fn_notify_on_forum_comment();
CREATE OR REPLACE TRIGGER trg_forum_posts_updated_at BEFORE UPDATE ON forum_posts FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE OR REPLACE TRIGGER trg_auto_school_id BEFORE INSERT ON guru_wali_assignments FOR EACH ROW EXECUTE FUNCTION fn_auto_set_school_id();
CREATE OR REPLACE TRIGGER trg_forum_assignment_tenant BEFORE INSERT OR UPDATE ON guru_wali_assignments FOR EACH ROW EXECUTE FUNCTION fn_guard_forum_assignment_tenant();
CREATE OR REPLACE TRIGGER trg_notify_late_arrival AFTER INSERT ON late_arrivals FOR EACH ROW EXECUTE FUNCTION fn_notify_on_late_arrival();
CREATE OR REPLACE TRIGGER trg_ld_nodes_updated_at BEFORE UPDATE ON ld_document_nodes FOR EACH ROW EXECUTE FUNCTION update_ld_updated_at();
CREATE OR REPLACE TRIGGER trg_ld_documents_updated_at BEFORE UPDATE ON ld_documents FOR EACH ROW EXECUTE FUNCTION update_ld_updated_at();
CREATE OR REPLACE TRIGGER trg_school_knowledge_updated_at BEFORE UPDATE ON ld_program_knowledge_school FOR EACH ROW EXECUTE FUNCTION update_ld_updated_at();
CREATE OR REPLACE TRIGGER trg_teacher_knowledge_updated_at BEFORE UPDATE ON ld_teacher_knowledge FOR EACH ROW EXECUTE FUNCTION update_ld_updated_at();
CREATE OR REPLACE TRIGGER trg_audit_observations_delete BEFORE DELETE ON observations FOR EACH ROW EXECUTE FUNCTION fn_audit_log_delete();
CREATE OR REPLACE TRIGGER trg_auto_school_id BEFORE INSERT ON observations FOR EACH ROW EXECUTE FUNCTION fn_auto_set_school_id();
CREATE OR REPLACE TRIGGER trg_notify_observation AFTER INSERT ON observations FOR EACH ROW EXECUTE FUNCTION fn_notify_on_observation();
CREATE OR REPLACE TRIGGER trg_observation_visibility_default BEFORE INSERT ON observations FOR EACH ROW EXECUTE FUNCTION fn_observation_visibility_default();
CREATE OR REPLACE TRIGGER trg_observation_visibility_immutable BEFORE UPDATE ON observations FOR EACH ROW WHEN (new.visibility IS DISTINCT FROM old.visibility) EXECUTE FUNCTION fn_observation_visibility_immutable();
CREATE OR REPLACE TRIGGER trg_set_updated_at_observations BEFORE UPDATE ON observations FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE OR REPLACE TRIGGER trg_auto_school_id BEFORE INSERT ON pkl_attendance FOR EACH ROW EXECUTE FUNCTION fn_auto_set_school_id();
CREATE OR REPLACE TRIGGER trg_pkl_attendance_period_lock BEFORE INSERT OR UPDATE ON pkl_attendance FOR EACH ROW EXECUTE FUNCTION fn_pkl_attendance_period_lock();
CREATE OR REPLACE TRIGGER trg_pkl_attendance_student_match_check BEFORE INSERT OR UPDATE ON pkl_attendance FOR EACH ROW EXECUTE FUNCTION trg_pkl_attendance_student_match();
CREATE OR REPLACE TRIGGER trg_pkl_attendance_touch BEFORE UPDATE ON pkl_attendance FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();
CREATE OR REPLACE TRIGGER trg_auto_school_id BEFORE INSERT ON pkl_placements FOR EACH ROW EXECUTE FUNCTION fn_auto_set_school_id();
CREATE OR REPLACE TRIGGER trg_set_updated_at_pkl_placements BEFORE UPDATE ON pkl_placements FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE OR REPLACE TRIGGER trg_auto_school_id BEFORE INSERT ON programs FOR EACH ROW EXECUTE FUNCTION fn_auto_set_school_id();
CREATE OR REPLACE TRIGGER trg_set_updated_at_programs BEFORE UPDATE ON programs FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE OR REPLACE TRIGGER trg_auto_school_id BEFORE INSERT ON schedule_templates FOR EACH ROW EXECUTE FUNCTION fn_auto_set_school_id();
CREATE OR REPLACE TRIGGER trg_auto_school_id BEFORE INSERT ON schedule_time_slots FOR EACH ROW EXECUTE FUNCTION fn_auto_set_school_id();
CREATE OR REPLACE TRIGGER trg_auto_school_id BEFORE INSERT ON school_config FOR EACH ROW EXECUTE FUNCTION fn_auto_set_school_id();
CREATE OR REPLACE TRIGGER trg_notify_exit AFTER INSERT ON student_exits FOR EACH ROW EXECUTE FUNCTION fn_notify_on_exit();
CREATE OR REPLACE TRIGGER trg_auto_school_id BEFORE INSERT ON student_parents FOR EACH ROW EXECUTE FUNCTION fn_auto_set_school_id();
CREATE OR REPLACE TRIGGER trg_validate_student_parent_tenant BEFORE INSERT OR UPDATE ON student_parents FOR EACH ROW EXECUTE FUNCTION fn_validate_student_parent_tenant();
CREATE OR REPLACE TRIGGER trg_auto_school_id BEFORE INSERT ON student_updates FOR EACH ROW EXECUTE FUNCTION fn_auto_set_school_id();
CREATE OR REPLACE TRIGGER trg_set_updated_at_student_updates BEFORE UPDATE ON student_updates FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE OR REPLACE TRIGGER student_graduation_close_enrollment AFTER UPDATE OF student_status ON students FOR EACH ROW EXECUTE FUNCTION trg_close_enrollment_on_graduation();
CREATE OR REPLACE TRIGGER student_name_sync AFTER UPDATE OF full_name ON students FOR EACH ROW EXECUTE FUNCTION trg_sync_student_name_to_user();
CREATE OR REPLACE TRIGGER trg_auto_school_id BEFORE INSERT ON students FOR EACH ROW EXECUTE FUNCTION fn_auto_set_school_id();
CREATE OR REPLACE TRIGGER trg_pkl_status_consistency BEFORE UPDATE ON students FOR EACH ROW WHEN (new.student_status IS DISTINCT FROM old.student_status) EXECUTE FUNCTION fn_pkl_status_consistency();
CREATE OR REPLACE TRIGGER trg_set_updated_at_students BEFORE UPDATE ON students FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE OR REPLACE TRIGGER trg_student_nis_immutable BEFORE UPDATE ON students FOR EACH ROW WHEN (new.nis::text IS DISTINCT FROM old.nis::text) EXECUTE FUNCTION fn_student_nis_immutable();
CREATE OR REPLACE TRIGGER trg_auto_school_id BEFORE INSERT ON subjects FOR EACH ROW EXECUTE FUNCTION fn_auto_set_school_id();
CREATE OR REPLACE TRIGGER trg_set_updated_at_subjects BEFORE UPDATE ON subjects FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE OR REPLACE TRIGGER trg_auto_school_id BEFORE INSERT ON substitute_schedules FOR EACH ROW EXECUTE FUNCTION fn_auto_set_school_id();
CREATE OR REPLACE TRIGGER trg_set_updated_at_substitute_schedules BEFORE UPDATE ON substitute_schedules FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE OR REPLACE TRIGGER trg_substitute_not_original_check BEFORE INSERT OR UPDATE ON substitute_schedules FOR EACH ROW EXECUTE FUNCTION trg_substitute_not_original();
CREATE OR REPLACE TRIGGER trg_auto_school_id BEFORE INSERT ON sync_idempotency FOR EACH ROW EXECUTE FUNCTION fn_auto_set_school_id();
CREATE OR REPLACE TRIGGER trg_auto_school_id BEFORE INSERT ON teacher_attendance_log FOR EACH ROW EXECUTE FUNCTION fn_auto_set_school_id();
CREATE OR REPLACE TRIGGER trg_guard_teacher_doc_status BEFORE UPDATE OF status ON teacher_documents FOR EACH ROW WHEN (old.status::text IS DISTINCT FROM new.status::text) EXECUTE FUNCTION fn_guard_teacher_doc_status_transition();
CREATE OR REPLACE TRIGGER trg_auto_school_id BEFORE INSERT ON teacher_journals FOR EACH ROW EXECUTE FUNCTION fn_auto_set_school_id();
CREATE OR REPLACE TRIGGER trg_set_updated_at_teacher_journals BEFORE UPDATE ON teacher_journals FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE OR REPLACE TRIGGER trg_auto_school_id BEFORE INSERT ON teaching_assignments FOR EACH ROW EXECUTE FUNCTION fn_auto_set_school_id();
CREATE OR REPLACE TRIGGER trg_set_updated_at_teaching_assignments BEFORE UPDATE ON teaching_assignments FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE OR REPLACE TRIGGER trg_teaching_cp_updated_at BEFORE UPDATE ON teaching_cp FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE OR REPLACE TRIGGER trg_teaching_cp_elements_updated_at BEFORE UPDATE ON teaching_cp_elements FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE OR REPLACE TRIGGER trg_auto_school_id BEFORE INSERT ON teaching_schedules FOR EACH ROW EXECUTE FUNCTION fn_auto_set_school_id();
CREATE OR REPLACE TRIGGER trg_set_updated_at_teaching_schedules BEFORE UPDATE ON teaching_schedules FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE OR REPLACE TRIGGER trg_unvoid_session_attendance AFTER UPDATE OF meeting_status ON teaching_schedules FOR EACH ROW WHEN (new.meeting_status = 'NORMAL'::meeting_status AND old.meeting_status = 'GURU_TIDAK_HADIR'::meeting_status) EXECUTE FUNCTION fn_unvoid_session_attendance();
CREATE OR REPLACE TRIGGER trg_void_session_attendance AFTER UPDATE ON teaching_schedules FOR EACH ROW WHEN (new.meeting_status = 'GURU_TIDAK_HADIR'::meeting_status AND old.meeting_status IS DISTINCT FROM new.meeting_status) EXECUTE FUNCTION fn_void_session_attendance();
CREATE OR REPLACE TRIGGER trg_guard_users_protected_columns BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION fn_guard_users_protected_columns();
CREATE OR REPLACE TRIGGER trg_set_updated_at_users BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE OR REPLACE TRIGGER user_name_sync AFTER UPDATE OF full_name ON users FOR EACH ROW EXECUTE FUNCTION trg_sync_user_name_to_student();

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE core.capaian_pembelajaran ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.cp_elements ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.curriculum_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.education_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.knowledge_national ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.subject_name_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.subject_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.vocational_concentrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.vocational_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.vocational_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_rubric_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_rubric_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bk_class_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capaian_pembelajaran ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coaching_case_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coaching_case_handlers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coaching_case_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coaching_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duty_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_post_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_post_audience ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_post_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_post_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grade_recap ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guru_wali_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.late_arrivals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ld_context_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ld_document_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ld_document_tp_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ld_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ld_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ld_program_knowledge_national ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ld_program_knowledge_school ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ld_prompt_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ld_teacher_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_auth_deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pkl_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pkl_placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_reapply_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_reapply_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_exits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subject_code_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subject_cp_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.substitute_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_attendance_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_document_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_document_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_piket_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_cp ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_cp_elements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tp_taught_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tujuan_pembelajaran ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Policy
-- ============================================================
DROP POLICY IF EXISTS "core_capaian_pembelajaran_read" ON core.capaian_pembelajaran;
CREATE POLICY "core_capaian_pembelajaran_read" ON core.capaian_pembelajaran AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS "core_cp_elements_read" ON core.cp_elements;
CREATE POLICY "core_cp_elements_read" ON core.cp_elements AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS "core_curriculum_versions_read" ON core.curriculum_versions;
CREATE POLICY "core_curriculum_versions_read" ON core.curriculum_versions AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS "core_education_levels_read" ON core.education_levels;
CREATE POLICY "core_education_levels_read" ON core.education_levels AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS "core_knowledge_national_read" ON core.knowledge_national;
CREATE POLICY "core_knowledge_national_read" ON core.knowledge_national AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS "core_phases_read" ON core.phases;
CREATE POLICY "core_phases_read" ON core.phases AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS "authenticated can select subject_name_mapping" ON core.subject_name_mapping;
CREATE POLICY "authenticated can select subject_name_mapping" ON core.subject_name_mapping AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_active = true));
DROP POLICY IF EXISTS "core_subject_phases_read" ON core.subject_phases;
CREATE POLICY "core_subject_phases_read" ON core.subject_phases AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS "core_subjects_read" ON core.subjects;
CREATE POLICY "core_subjects_read" ON core.subjects AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS "core_vocational_concentrations_read" ON core.vocational_concentrations;
CREATE POLICY "core_vocational_concentrations_read" ON core.vocational_concentrations AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS "core_vocational_fields_read" ON core.vocational_fields;
CREATE POLICY "core_vocational_fields_read" ON core.vocational_fields AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS "core_vocational_programs_read" ON core.vocational_programs;
CREATE POLICY "core_vocational_programs_read" ON core.vocational_programs AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS "rls_academic_periods_insert_administrative" ON public.academic_periods;
CREATE POLICY "rls_academic_periods_insert_administrative" ON public.academic_periods AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "rls_academic_periods_read_all" ON public.academic_periods;
CREATE POLICY "rls_academic_periods_read_all" ON public.academic_periods AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (auth.uid() IS NOT NULL)));
DROP POLICY IF EXISTS "rls_academic_periods_update_administrative" ON public.academic_periods;
CREATE POLICY "rls_academic_periods_update_administrative" ON public.academic_periods AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "rls_ac_delete" ON public.assessment_criteria;
CREATE POLICY "rls_ac_delete" ON public.assessment_criteria AS PERMISSIVE FOR DELETE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (learning_objective_id IN ( SELECT learning_objectives.id
   FROM learning_objectives
  WHERE (learning_objectives.teacher_id = fn_current_user_id())))));
DROP POLICY IF EXISTS "rls_ac_insert" ON public.assessment_criteria;
CREATE POLICY "rls_ac_insert" ON public.assessment_criteria AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (((school_id = fn_current_school_id()) AND (learning_objective_id IN ( SELECT learning_objectives.id
   FROM learning_objectives
  WHERE (learning_objectives.teacher_id = fn_current_user_id())))));
DROP POLICY IF EXISTS "rls_ac_select_guru" ON public.assessment_criteria;
CREATE POLICY "rls_ac_select_guru" ON public.assessment_criteria AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'GURU'::role_type) AND fn_owns_learning_objective(learning_objective_id)));
DROP POLICY IF EXISTS "rls_ac_update" ON public.assessment_criteria;
CREATE POLICY "rls_ac_update" ON public.assessment_criteria AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (learning_objective_id IN ( SELECT learning_objectives.id
   FROM learning_objectives
  WHERE (learning_objectives.teacher_id = fn_current_user_id())))))
  WITH CHECK (((school_id = fn_current_school_id()) AND (learning_objective_id IN ( SELECT learning_objectives.id
   FROM learning_objectives
  WHERE (learning_objectives.teacher_id = fn_current_user_id())))));
DROP POLICY IF EXISTS "rls_assessment_results_delete_owner" ON public.assessment_results;
CREATE POLICY "rls_assessment_results_delete_owner" ON public.assessment_results AS PERMISSIVE FOR DELETE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND fn_owns_assessment(assessment_id)));
DROP POLICY IF EXISTS "rls_assessment_results_insert_owner" ON public.assessment_results;
CREATE POLICY "rls_assessment_results_insert_owner" ON public.assessment_results AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (((school_id = fn_current_school_id()) AND fn_owns_assessment(assessment_id)));
DROP POLICY IF EXISTS "rls_assessment_results_select_guru" ON public.assessment_results;
CREATE POLICY "rls_assessment_results_select_guru" ON public.assessment_results AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'GURU'::role_type) AND fn_owns_assessment(assessment_id)));
DROP POLICY IF EXISTS "rls_assessment_results_select_ortu" ON public.assessment_results;
CREATE POLICY "rls_assessment_results_select_ortu" ON public.assessment_results AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ORTU'::role_type) AND fn_portal_can_read_student(student_id) AND fn_portal_assessment_visible(assessment_id)));
DROP POLICY IF EXISTS "rls_assessment_results_select_siswa" ON public.assessment_results;
CREATE POLICY "rls_assessment_results_select_siswa" ON public.assessment_results AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'SISWA'::role_type) AND (student_id = fn_current_student_id()) AND fn_portal_assessment_visible(assessment_id)));
DROP POLICY IF EXISTS "rls_assessment_results_select_supervision" ON public.assessment_results;
CREATE POLICY "rls_assessment_results_select_supervision" ON public.assessment_results AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KAPRODI'::role_type, 'KEPSEK'::role_type, 'WAKA_KURIKULUM'::role_type, 'WAKA_HUMAS'::role_type, 'WAKA_KESISWAAN'::role_type]))));
DROP POLICY IF EXISTS "rls_assessment_results_select_wali" ON public.assessment_results;
CREATE POLICY "rls_assessment_results_select_wali" ON public.assessment_results AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'WALI_KELAS'::role_type) AND fn_wali_of_student(student_id)));
DROP POLICY IF EXISTS "rls_assessment_results_update_owner" ON public.assessment_results;
CREATE POLICY "rls_assessment_results_update_owner" ON public.assessment_results AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND fn_owns_assessment(assessment_id)))
  WITH CHECK (((school_id = fn_current_school_id()) AND fn_owns_assessment(assessment_id)));
DROP POLICY IF EXISTS "rls_rubric_criteria_delete_guru" ON public.assessment_rubric_criteria;
CREATE POLICY "rls_rubric_criteria_delete_guru" ON public.assessment_rubric_criteria AS PERMISSIVE FOR DELETE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id()) AND (fn_current_user_role() = 'GURU'::role_type)));
DROP POLICY IF EXISTS "rls_rubric_criteria_insert_guru" ON public.assessment_rubric_criteria;
CREATE POLICY "rls_rubric_criteria_insert_guru" ON public.assessment_rubric_criteria AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id()) AND (fn_current_user_role() = 'GURU'::role_type)));
DROP POLICY IF EXISTS "rls_rubric_criteria_select_guru" ON public.assessment_rubric_criteria;
CREATE POLICY "rls_rubric_criteria_select_guru" ON public.assessment_rubric_criteria AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'GURU'::role_type) AND (teacher_id = fn_current_user_id())));
DROP POLICY IF EXISTS "rls_rubric_criteria_select_kepsek_waka" ON public.assessment_rubric_criteria;
CREATE POLICY "rls_rubric_criteria_select_kepsek_waka" ON public.assessment_rubric_criteria AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KEPSEK'::role_type, 'WAKA_KURIKULUM'::role_type, 'WAKA_HUMAS'::role_type, 'WAKA_KESISWAAN'::role_type]))));
DROP POLICY IF EXISTS "rls_rubric_criteria_update_guru" ON public.assessment_rubric_criteria;
CREATE POLICY "rls_rubric_criteria_update_guru" ON public.assessment_rubric_criteria AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id()) AND (fn_current_user_role() = 'GURU'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id())));
DROP POLICY IF EXISTS "rls_rubric_results_delete_guru" ON public.assessment_rubric_results;
CREATE POLICY "rls_rubric_results_delete_guru" ON public.assessment_rubric_results AS PERMISSIVE FOR DELETE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id()) AND (fn_current_user_role() = 'GURU'::role_type)));
DROP POLICY IF EXISTS "rls_rubric_results_insert_guru" ON public.assessment_rubric_results;
CREATE POLICY "rls_rubric_results_insert_guru" ON public.assessment_rubric_results AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id()) AND (fn_current_user_role() = 'GURU'::role_type)));
DROP POLICY IF EXISTS "rls_rubric_results_select_guru" ON public.assessment_rubric_results;
CREATE POLICY "rls_rubric_results_select_guru" ON public.assessment_rubric_results AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'GURU'::role_type) AND (teacher_id = fn_current_user_id())));
DROP POLICY IF EXISTS "rls_rubric_results_select_kepsek_waka" ON public.assessment_rubric_results;
CREATE POLICY "rls_rubric_results_select_kepsek_waka" ON public.assessment_rubric_results AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KEPSEK'::role_type, 'WAKA_KURIKULUM'::role_type, 'WAKA_HUMAS'::role_type, 'WAKA_KESISWAAN'::role_type]))));
DROP POLICY IF EXISTS "rls_rubric_results_update_guru" ON public.assessment_rubric_results;
CREATE POLICY "rls_rubric_results_update_guru" ON public.assessment_rubric_results AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id()) AND (fn_current_user_role() = 'GURU'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id())));
DROP POLICY IF EXISTS "rls_assessments_delete_owner" ON public.assessments;
CREATE POLICY "rls_assessments_delete_owner" ON public.assessments AS PERMISSIVE FOR DELETE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id())));
DROP POLICY IF EXISTS "rls_assessments_insert_owner" ON public.assessments;
CREATE POLICY "rls_assessments_insert_owner" ON public.assessments AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id())));
DROP POLICY IF EXISTS "rls_assessments_select_guru" ON public.assessments;
CREATE POLICY "rls_assessments_select_guru" ON public.assessments AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'GURU'::role_type) AND (teacher_id = fn_current_user_id())));
DROP POLICY IF EXISTS "rls_assessments_select_ortu" ON public.assessments;
CREATE POLICY "rls_assessments_select_ortu" ON public.assessments AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ORTU'::role_type) AND (is_visible_ortu = true) AND fn_parent_has_child_in_class(class_id)));
DROP POLICY IF EXISTS "rls_assessments_select_siswa" ON public.assessments;
CREATE POLICY "rls_assessments_select_siswa" ON public.assessments AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'SISWA'::role_type) AND (is_visible_siswa = true) AND fn_student_enrolled_in_class(class_id)));
DROP POLICY IF EXISTS "rls_assessments_select_supervision" ON public.assessments;
CREATE POLICY "rls_assessments_select_supervision" ON public.assessments AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KAPRODI'::role_type, 'KEPSEK'::role_type, 'WAKA_KURIKULUM'::role_type, 'WAKA_HUMAS'::role_type, 'WAKA_KESISWAAN'::role_type]))));
DROP POLICY IF EXISTS "rls_assessments_select_wali" ON public.assessments;
CREATE POLICY "rls_assessments_select_wali" ON public.assessments AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'WALI_KELAS'::role_type) AND (class_id = fn_wali_kelas_class_id())));
DROP POLICY IF EXISTS "rls_assessments_update_owner" ON public.assessments;
CREATE POLICY "rls_assessments_update_owner" ON public.assessments AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id())))
  WITH CHECK (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id())));
DROP POLICY IF EXISTS "rls_attendance_read_parent" ON public.attendance;
CREATE POLICY "rls_attendance_read_parent" ON public.attendance AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ORTU'::role_type) AND (is_void = false) AND (EXISTS ( SELECT 1
   FROM student_parents sp
  WHERE ((sp.student_id = attendance.student_id) AND (sp.parent_user_id = fn_current_user_id()))))));
DROP POLICY IF EXISTS "rls_attendance_read_staff" ON public.attendance;
CREATE POLICY "rls_attendance_read_staff" ON public.attendance AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (is_void = false) AND fn_can_see_student(student_id)));
DROP POLICY IF EXISTS "rls_attendance_read_student" ON public.attendance;
CREATE POLICY "rls_attendance_read_student" ON public.attendance AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'SISWA'::role_type) AND (student_id = ( SELECT s.student_id
   FROM students s
  WHERE (s.user_id = fn_current_user_id()))) AND (is_void = false)));
DROP POLICY IF EXISTS "rls_attendance_read_tu" ON public.attendance;
CREATE POLICY "rls_attendance_read_tu" ON public.attendance AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((fn_current_user_role() = 'TU'::role_type) AND (is_void = false) AND (EXISTS ( SELECT 1
   FROM teaching_schedules ts
  WHERE ((ts.schedule_id = attendance.schedule_id) AND (ts.school_id = fn_current_school_id()))))));
DROP POLICY IF EXISTS "rls_attendance_rw_guru" ON public.attendance;
CREATE POLICY "rls_attendance_rw_guru" ON public.attendance AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (EXISTS ( SELECT 1
   FROM teaching_schedules ts
  WHERE ((ts.schedule_id = attendance.schedule_id) AND ((ts.scheduled_teacher_id = fn_current_user_id()) OR (EXISTS ( SELECT 1
           FROM teaching_assignments ta
          WHERE ((ta.assignment_id = ts.assignment_id) AND (ta.user_id = fn_current_user_id()) AND (ta.is_active = true))))))))))
  WITH CHECK (((school_id = fn_current_school_id()) AND (EXISTS ( SELECT 1
   FROM teaching_schedules ts
  WHERE ((ts.schedule_id = attendance.schedule_id) AND ((ts.scheduled_teacher_id = fn_current_user_id()) OR (EXISTS ( SELECT 1
           FROM teaching_assignments ta
          WHERE ((ta.assignment_id = ts.assignment_id) AND (ta.user_id = fn_current_user_id()) AND (ta.is_active = true))))))))));
DROP POLICY IF EXISTS "rls_attendance_rw_substitute" ON public.attendance;
CREATE POLICY "rls_attendance_rw_substitute" ON public.attendance AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (EXISTS ( SELECT 1
   FROM substitute_schedules ss
  WHERE ((ss.schedule_id = attendance.schedule_id) AND (ss.substitute_user_id = fn_current_user_id()) AND (ss.sync_token_expires_at > now()))))))
  WITH CHECK (((school_id = fn_current_school_id()) AND (EXISTS ( SELECT 1
   FROM substitute_schedules ss
  WHERE ((ss.schedule_id = attendance.schedule_id) AND (ss.substitute_user_id = fn_current_user_id()) AND (ss.sync_token_expires_at > now()))))));
DROP POLICY IF EXISTS "rls_audit_log_read" ON public.audit_log;
CREATE POLICY "rls_audit_log_read" ON public.audit_log AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KEPSEK'::role_type, 'WAKA_KESISWAAN'::role_type, 'WAKA_HUMAS'::role_type, 'KAPRODI'::role_type, 'ADMINISTRATIVE'::role_type]))));
DROP POLICY IF EXISTS "rls_bk_class_read" ON public.bk_class_assignments;
CREATE POLICY "rls_bk_class_read" ON public.bk_class_assignments AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ((school_id = fn_current_school_id()));
DROP POLICY IF EXISTS "rls_bk_class_write" ON public.bk_class_assignments;
CREATE POLICY "rls_bk_class_write" ON public.bk_class_assignments AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KEPSEK'::role_type, 'WAKA_KESISWAAN'::role_type, 'ADMINISTRATIVE'::role_type]))))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KEPSEK'::role_type, 'WAKA_KESISWAAN'::role_type, 'ADMINISTRATIVE'::role_type]))));
DROP POLICY IF EXISTS "rls_cp_read" ON public.capaian_pembelajaran;
CREATE POLICY "rls_cp_read" ON public.capaian_pembelajaran AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ((school_id = fn_current_school_id()));
DROP POLICY IF EXISTS "rls_cp_write" ON public.capaian_pembelajaran;
CREATE POLICY "rls_cp_write" ON public.capaian_pembelajaran AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['ADMINISTRATIVE'::role_type, 'GURU'::role_type, 'WALI_KELAS'::role_type, 'BK'::role_type, 'KAPRODI'::role_type, 'WAKA_KURIKULUM'::role_type, 'WAKA_KESISWAAN'::role_type, 'WAKA_HUMAS'::role_type, 'KEPSEK'::role_type]))));
DROP POLICY IF EXISTS "rls_enrollments_read_administrative" ON public.class_enrollments;
CREATE POLICY "rls_enrollments_read_administrative" ON public.class_enrollments AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "rls_enrollments_read_parent" ON public.class_enrollments;
CREATE POLICY "rls_enrollments_read_parent" ON public.class_enrollments AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ORTU'::role_type) AND (EXISTS ( SELECT 1
   FROM student_parents sp
  WHERE ((sp.student_id = class_enrollments.student_id) AND (sp.parent_user_id = fn_current_user_id()))))));
DROP POLICY IF EXISTS "rls_enrollments_read_piket" ON public.class_enrollments;
CREATE POLICY "rls_enrollments_read_piket" ON public.class_enrollments AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND fn_is_on_duty_today()));
DROP POLICY IF EXISTS "rls_enrollments_read_staff" ON public.class_enrollments;
CREATE POLICY "rls_enrollments_read_staff" ON public.class_enrollments AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND fn_can_see_student(student_id)));
DROP POLICY IF EXISTS "rls_enrollments_read_student" ON public.class_enrollments;
CREATE POLICY "rls_enrollments_read_student" ON public.class_enrollments AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'SISWA'::role_type) AND (student_id = fn_current_student_id())));
DROP POLICY IF EXISTS "rls_enrollments_write_admin" ON public.class_enrollments;
CREATE POLICY "rls_enrollments_write_admin" ON public.class_enrollments AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_is_kepsek() OR fn_kaprodi_of_student(student_id))))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_is_kepsek() OR fn_kaprodi_of_student(student_id))));
DROP POLICY IF EXISTS "rls_enrollments_write_administrative" ON public.class_enrollments;
CREATE POLICY "rls_enrollments_write_administrative" ON public.class_enrollments AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "rls_classes_read_all" ON public.classes;
CREATE POLICY "rls_classes_read_all" ON public.classes AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (auth.uid() IS NOT NULL)));
DROP POLICY IF EXISTS "rls_classes_write_admin" ON public.classes;
CREATE POLICY "rls_classes_write_admin" ON public.classes AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "rls_cce_insert" ON public.coaching_case_events;
CREATE POLICY "rls_cce_insert" ON public.coaching_case_events AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((school_id = fn_current_school_id()) AND (author_user_id = fn_current_user_id()) AND ((current_setting('app.coaching_sync_active'::text, true) = 'true'::text) OR fn_is_kepsek() OR (EXISTS ( SELECT 1
   FROM coaching_cases c
  WHERE ((c.case_id = coaching_case_events.case_id) AND (c.current_handler_user_id = fn_current_user_id()) AND (c.status <> 'CLOSED'::case_status)))))));
DROP POLICY IF EXISTS "rls_cce_read_parent" ON public.coaching_case_events;
CREATE POLICY "rls_cce_read_parent" ON public.coaching_case_events AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ORTU'::role_type) AND (is_visible_to_student = true) AND (EXISTS ( SELECT 1
   FROM (coaching_cases c
     JOIN student_parents sp ON ((sp.student_id = c.student_id)))
  WHERE ((c.case_id = coaching_case_events.case_id) AND (c.is_shared_to_parent = true) AND (sp.parent_user_id = fn_current_user_id()))))));
DROP POLICY IF EXISTS "rls_cce_read_staff" ON public.coaching_case_events;
CREATE POLICY "rls_cce_read_staff" ON public.coaching_case_events AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() <> ALL (ARRAY['SISWA'::role_type, 'ORTU'::role_type, 'STAKEHOLDER'::role_type])) AND fn_can_see_coaching_case(case_id)));
DROP POLICY IF EXISTS "rls_cce_read_student" ON public.coaching_case_events;
CREATE POLICY "rls_cce_read_student" ON public.coaching_case_events AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'SISWA'::role_type) AND (is_visible_to_student = true) AND (EXISTS ( SELECT 1
   FROM coaching_cases c
  WHERE ((c.case_id = coaching_case_events.case_id) AND (c.is_shared_to_student = true) AND (c.student_id = ( SELECT s.student_id
           FROM students s
          WHERE (s.user_id = fn_current_user_id())
         LIMIT 1)))))));
DROP POLICY IF EXISTS "rls_cch_insert" ON public.coaching_case_handlers;
CREATE POLICY "rls_cch_insert" ON public.coaching_case_handlers AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((school_id = fn_current_school_id()) AND (pg_trigger_depth() > 0)));
DROP POLICY IF EXISTS "rls_cch_read_staff" ON public.coaching_case_handlers;
CREATE POLICY "rls_cch_read_staff" ON public.coaching_case_handlers AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() <> ALL (ARRAY['SISWA'::role_type, 'ORTU'::role_type, 'STAKEHOLDER'::role_type])) AND fn_can_see_coaching_case(case_id)));
DROP POLICY IF EXISTS "rls_cch_update" ON public.coaching_case_handlers;
CREATE POLICY "rls_cch_update" ON public.coaching_case_handlers AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((school_id = fn_current_school_id()) AND (pg_trigger_depth() > 0)));
DROP POLICY IF EXISTS "rls_cct_delete" ON public.coaching_case_templates;
CREATE POLICY "rls_cct_delete" ON public.coaching_case_templates AS PERMISSIVE FOR DELETE TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "rls_cct_insert" ON public.coaching_case_templates;
CREATE POLICY "rls_cct_insert" ON public.coaching_case_templates AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "rls_cct_read" ON public.coaching_case_templates;
CREATE POLICY "rls_cct_read" ON public.coaching_case_templates AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (is_active = true) AND (fn_current_user_role() <> ALL (ARRAY['SISWA'::role_type, 'ORTU'::role_type, 'STAKEHOLDER'::role_type]))));
DROP POLICY IF EXISTS "rls_cct_update" ON public.coaching_case_templates;
CREATE POLICY "rls_cct_update" ON public.coaching_case_templates AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "rls_cc_delete" ON public.coaching_cases;
CREATE POLICY "rls_cc_delete" ON public.coaching_cases AS PERMISSIVE FOR DELETE TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "rls_cc_insert" ON public.coaching_cases;
CREATE POLICY "rls_cc_insert" ON public.coaching_cases AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((school_id = fn_current_school_id()) AND (created_by_user_id = fn_current_user_id()) AND (current_handler_user_id = fn_current_user_id()) AND (fn_current_user_role() <> ALL (ARRAY['SISWA'::role_type, 'ORTU'::role_type, 'STAKEHOLDER'::role_type])) AND fn_student_in_current_school(student_id) AND (NOT ((fn_current_user_role() = 'DUDI'::role_type) AND ((track <> 'PKL'::case_track) OR (NOT fn_dudi_supervises_student(student_id)))))));
DROP POLICY IF EXISTS "rls_cc_read_dudi" ON public.coaching_cases;
CREATE POLICY "rls_cc_read_dudi" ON public.coaching_cases AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'DUDI'::role_type) AND (track = 'PKL'::case_track) AND fn_can_see_coaching_case(case_id)));
DROP POLICY IF EXISTS "rls_cc_read_parent" ON public.coaching_cases;
CREATE POLICY "rls_cc_read_parent" ON public.coaching_cases AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ORTU'::role_type) AND (is_shared_to_parent = true) AND (EXISTS ( SELECT 1
   FROM student_parents sp
  WHERE ((sp.student_id = coaching_cases.student_id) AND (sp.parent_user_id = fn_current_user_id()))))));
DROP POLICY IF EXISTS "rls_cc_read_staff" ON public.coaching_cases;
CREATE POLICY "rls_cc_read_staff" ON public.coaching_cases AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() <> ALL (ARRAY['SISWA'::role_type, 'ORTU'::role_type, 'STAKEHOLDER'::role_type])) AND fn_can_see_coaching_case(case_id)));
DROP POLICY IF EXISTS "rls_cc_read_student" ON public.coaching_cases;
CREATE POLICY "rls_cc_read_student" ON public.coaching_cases AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'SISWA'::role_type) AND (is_shared_to_student = true) AND (student_id = ( SELECT s.student_id
   FROM students s
  WHERE (s.user_id = fn_current_user_id())
 LIMIT 1))));
DROP POLICY IF EXISTS "rls_cc_update" ON public.coaching_cases;
CREATE POLICY "rls_cc_update" ON public.coaching_cases AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((school_id = fn_current_school_id()) AND (pg_trigger_depth() > 0)))
  WITH CHECK (((school_id = fn_current_school_id()) AND fn_student_in_current_school(student_id)));
DROP POLICY IF EXISTS "rls_comm_cat_read" ON public.communication_categories;
CREATE POLICY "rls_comm_cat_read" ON public.communication_categories AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_active = true));
DROP POLICY IF EXISTS "rls_duty_schedules_read" ON public.duty_schedules;
CREATE POLICY "rls_duty_schedules_read" ON public.duty_schedules AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type, 'KEPSEK'::role_type, 'WAKA_KURIKULUM'::role_type, 'WAKA_KESISWAAN'::role_type, 'WAKA_HUMAS'::role_type, 'ADMINISTRATIVE'::role_type]))));
DROP POLICY IF EXISTS "rls_duty_schedules_read_tu" ON public.duty_schedules;
CREATE POLICY "rls_duty_schedules_read_tu" ON public.duty_schedules AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'TU'::role_type)));
DROP POLICY IF EXISTS "rls_duty_schedules_write" ON public.duty_schedules;
CREATE POLICY "rls_duty_schedules_write" ON public.duty_schedules AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND ((fn_current_user_role() = 'ADMINISTRATIVE'::role_type) OR fn_is_kepsek())));
DROP POLICY IF EXISTS "el_insert" ON public.evaluation_logs;
CREATE POLICY "el_insert" ON public.evaluation_logs AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK ((school_id = fn_current_school_id()));
DROP POLICY IF EXISTS "el_select" ON public.evaluation_logs;
CREATE POLICY "el_select" ON public.evaluation_logs AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ((school_id = fn_current_school_id()));
DROP POLICY IF EXISTS "rls_forum_ack_delete" ON public.forum_post_acknowledgements;
CREATE POLICY "rls_forum_ack_delete" ON public.forum_post_acknowledgements AS PERMISSIVE FOR DELETE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (user_id = fn_current_user_id())));
DROP POLICY IF EXISTS "rls_forum_ack_insert" ON public.forum_post_acknowledgements;
CREATE POLICY "rls_forum_ack_insert" ON public.forum_post_acknowledgements AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (((school_id = fn_current_school_id()) AND (user_id = fn_current_user_id()) AND fn_can_read_forum_post(post_id)));
DROP POLICY IF EXISTS "rls_forum_ack_read" ON public.forum_post_acknowledgements;
CREATE POLICY "rls_forum_ack_read" ON public.forum_post_acknowledgements AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND fn_can_read_forum_post(post_id)));
DROP POLICY IF EXISTS "rls_forum_aud_author_read" ON public.forum_post_audience;
CREATE POLICY "rls_forum_aud_author_read" ON public.forum_post_audience AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (EXISTS ( SELECT 1
   FROM forum_posts fp
  WHERE ((fp.post_id = forum_post_audience.post_id) AND (fp.author_user_id = fn_current_user_id()) AND (fp.school_id = fn_current_school_id()))))));
DROP POLICY IF EXISTS "rls_forum_aud_read" ON public.forum_post_audience;
CREATE POLICY "rls_forum_aud_read" ON public.forum_post_audience AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND fn_can_read_forum_post(post_id)));
DROP POLICY IF EXISTS "rls_forum_aud_sekolah_read" ON public.forum_post_audience;
CREATE POLICY "rls_forum_aud_sekolah_read" ON public.forum_post_audience AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (user_id = fn_current_user_id()) AND (EXISTS ( SELECT 1
   FROM forum_posts fp
  WHERE ((fp.post_id = forum_post_audience.post_id) AND (fp.scope_type = 'SEKOLAH'::text) AND (fp.school_id = fn_current_school_id()) AND (fp.is_withdrawn = false))))));
DROP POLICY IF EXISTS "rls_forum_post_audience_read_tu" ON public.forum_post_audience;
CREATE POLICY "rls_forum_post_audience_read_tu" ON public.forum_post_audience AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'TU'::role_type)));
DROP POLICY IF EXISTS "rls_forum_comments_delete" ON public.forum_post_comments;
CREATE POLICY "rls_forum_comments_delete" ON public.forum_post_comments AS PERMISSIVE FOR DELETE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND ((author_user_id = fn_current_user_id()) OR (fn_current_user_role() = ANY (ARRAY['KEPSEK'::role_type, 'WAKA_KESISWAAN'::role_type])))));
DROP POLICY IF EXISTS "rls_forum_comments_insert" ON public.forum_post_comments;
CREATE POLICY "rls_forum_comments_insert" ON public.forum_post_comments AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((school_id = fn_current_school_id()) AND (author_user_id = fn_current_user_id()) AND fn_can_read_forum_post(post_id) AND (fn_current_user_role() = ANY (ARRAY['GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type, 'KAPRODI'::role_type, 'KEPSEK'::role_type, 'ADMINISTRATIVE'::role_type, 'WAKA_KURIKULUM'::role_type, 'WAKA_KESISWAAN'::role_type, 'WAKA_HUMAS'::role_type, 'ORTU'::role_type, 'TU'::role_type]))));
DROP POLICY IF EXISTS "rls_forum_comments_read" ON public.forum_post_comments;
CREATE POLICY "rls_forum_comments_read" ON public.forum_post_comments AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND fn_can_read_forum_post(post_id)));
DROP POLICY IF EXISTS "rls_forum_comments_update" ON public.forum_post_comments;
CREATE POLICY "rls_forum_comments_update" ON public.forum_post_comments AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (author_user_id = fn_current_user_id())))
  WITH CHECK (((school_id = fn_current_school_id()) AND (author_user_id = fn_current_user_id())));
DROP POLICY IF EXISTS "rls_forum_post_comments_read_tu" ON public.forum_post_comments;
CREATE POLICY "rls_forum_post_comments_read_tu" ON public.forum_post_comments AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'TU'::role_type)));
DROP POLICY IF EXISTS "rls_forum_subj_read" ON public.forum_post_subjects;
CREATE POLICY "rls_forum_subj_read" ON public.forum_post_subjects AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND fn_can_read_forum_post(post_id)));
DROP POLICY IF EXISTS "rls_forum_posts_delete" ON public.forum_posts;
CREATE POLICY "rls_forum_posts_delete" ON public.forum_posts AS PERMISSIVE FOR DELETE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND ((author_user_id = fn_current_user_id()) OR (fn_current_user_role() = ANY (ARRAY['KEPSEK'::role_type, 'WAKA_KESISWAAN'::role_type])))));
DROP POLICY IF EXISTS "rls_forum_posts_read" ON public.forum_posts;
CREATE POLICY "rls_forum_posts_read" ON public.forum_posts AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND fn_can_read_forum_post(post_id)));
DROP POLICY IF EXISTS "rls_forum_posts_read_tu" ON public.forum_posts;
CREATE POLICY "rls_forum_posts_read_tu" ON public.forum_posts AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'TU'::role_type)));
DROP POLICY IF EXISTS "rls_forum_posts_update" ON public.forum_posts;
CREATE POLICY "rls_forum_posts_update" ON public.forum_posts AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (author_user_id = fn_current_user_id())))
  WITH CHECK (((school_id = fn_current_school_id()) AND (author_user_id = fn_current_user_id()) AND (NOT (class_id IS DISTINCT FROM ( SELECT fp2.class_id
   FROM forum_posts fp2
  WHERE (fp2.post_id = forum_posts.post_id)))) AND (NOT (visibility IS DISTINCT FROM ( SELECT fp2.visibility
   FROM forum_posts fp2
  WHERE (fp2.post_id = forum_posts.post_id)))) AND (NOT (academic_year IS DISTINCT FROM ( SELECT fp2.academic_year
   FROM forum_posts fp2
  WHERE (fp2.post_id = forum_posts.post_id)))) AND (NOT (audience_type IS DISTINCT FROM ( SELECT fp2.audience_type
   FROM forum_posts fp2
  WHERE (fp2.post_id = forum_posts.post_id)))) AND (NOT (audience_type_2 IS DISTINCT FROM ( SELECT fp2.audience_type_2
   FROM forum_posts fp2
  WHERE (fp2.post_id = forum_posts.post_id))))));
DROP POLICY IF EXISTS "gj_insert" ON public.generation_jobs;
CREATE POLICY "gj_insert" ON public.generation_jobs AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (((school_id = fn_current_school_id()) AND (teacher_user_id = auth.uid())));
DROP POLICY IF EXISTS "gj_select" ON public.generation_jobs;
CREATE POLICY "gj_select" ON public.generation_jobs AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (teacher_user_id = auth.uid())));
DROP POLICY IF EXISTS "gj_update" ON public.generation_jobs;
CREATE POLICY "gj_update" ON public.generation_jobs AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (teacher_user_id = auth.uid())));
DROP POLICY IF EXISTS "rls_grade_recap_delete_owner" ON public.grade_recap;
CREATE POLICY "rls_grade_recap_delete_owner" ON public.grade_recap AS PERMISSIVE FOR DELETE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND fn_owns_learning_objective(learning_objective_id)));
DROP POLICY IF EXISTS "rls_grade_recap_insert_owner" ON public.grade_recap;
CREATE POLICY "rls_grade_recap_insert_owner" ON public.grade_recap AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (((school_id = fn_current_school_id()) AND fn_owns_learning_objective(learning_objective_id)));
DROP POLICY IF EXISTS "rls_grade_recap_select_guru" ON public.grade_recap;
CREATE POLICY "rls_grade_recap_select_guru" ON public.grade_recap AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'GURU'::role_type) AND fn_owns_learning_objective(learning_objective_id)));
DROP POLICY IF EXISTS "rls_grade_recap_select_ortu" ON public.grade_recap;
CREATE POLICY "rls_grade_recap_select_ortu" ON public.grade_recap AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ORTU'::role_type) AND fn_portal_can_read_student(student_id) AND fn_portal_recap_visible(learning_objective_id)));
DROP POLICY IF EXISTS "rls_grade_recap_select_siswa" ON public.grade_recap;
CREATE POLICY "rls_grade_recap_select_siswa" ON public.grade_recap AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'SISWA'::role_type) AND (student_id = fn_current_student_id()) AND fn_portal_recap_visible(learning_objective_id)));
DROP POLICY IF EXISTS "rls_grade_recap_select_supervision" ON public.grade_recap;
CREATE POLICY "rls_grade_recap_select_supervision" ON public.grade_recap AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KAPRODI'::role_type, 'KEPSEK'::role_type, 'WAKA_KURIKULUM'::role_type, 'WAKA_HUMAS'::role_type, 'WAKA_KESISWAAN'::role_type]))));
DROP POLICY IF EXISTS "rls_grade_recap_select_wali" ON public.grade_recap;
CREATE POLICY "rls_grade_recap_select_wali" ON public.grade_recap AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'WALI_KELAS'::role_type) AND fn_wali_of_student(student_id)));
DROP POLICY IF EXISTS "rls_grade_recap_update_owner" ON public.grade_recap;
CREATE POLICY "rls_grade_recap_update_owner" ON public.grade_recap AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND fn_owns_learning_objective(learning_objective_id)))
  WITH CHECK (((school_id = fn_current_school_id()) AND fn_owns_learning_objective(learning_objective_id)));
DROP POLICY IF EXISTS "rls_guru_wali_read" ON public.guru_wali_assignments;
CREATE POLICY "rls_guru_wali_read" ON public.guru_wali_assignments AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ((school_id = fn_current_school_id()));
DROP POLICY IF EXISTS "rls_guru_wali_write" ON public.guru_wali_assignments;
CREATE POLICY "rls_guru_wali_write" ON public.guru_wali_assignments AS PERMISSIVE FOR ALL TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "rls_late_arrivals_delete_own" ON public.late_arrivals;
CREATE POLICY "rls_late_arrivals_delete_own" ON public.late_arrivals AS PERMISSIVE FOR DELETE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (recorded_by = fn_current_user_id()) AND fn_is_on_duty_today()));
DROP POLICY IF EXISTS "rls_late_arrivals_insert" ON public.late_arrivals;
CREATE POLICY "rls_late_arrivals_insert" ON public.late_arrivals AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (((school_id = fn_current_school_id()) AND fn_student_in_current_school(student_id) AND fn_is_on_duty_today() AND (recorded_by = fn_current_user_id()) AND (late_date = ((now() AT TIME ZONE 'Asia/Jakarta'::text))::date)));
DROP POLICY IF EXISTS "rls_late_arrivals_read_parent" ON public.late_arrivals;
CREATE POLICY "rls_late_arrivals_read_parent" ON public.late_arrivals AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ORTU'::role_type) AND (EXISTS ( SELECT 1
   FROM student_parents sp
  WHERE ((sp.student_id = late_arrivals.student_id) AND (sp.parent_user_id = fn_current_user_id()))))));
DROP POLICY IF EXISTS "rls_late_arrivals_read_staff" ON public.late_arrivals;
CREATE POLICY "rls_late_arrivals_read_staff" ON public.late_arrivals AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_is_on_duty_today() OR fn_is_kepsek() OR fn_is_waka_kesiswaan() OR (fn_current_user_role() = 'ADMINISTRATIVE'::role_type))));
DROP POLICY IF EXISTS "rls_late_arrivals_read_student" ON public.late_arrivals;
CREATE POLICY "rls_late_arrivals_read_student" ON public.late_arrivals AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'SISWA'::role_type) AND (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.student_id = late_arrivals.student_id) AND (s.user_id = fn_current_user_id()) AND (s.school_id = fn_current_school_id()))))));
DROP POLICY IF EXISTS "rls_late_arrivals_read_tu" ON public.late_arrivals;
CREATE POLICY "rls_late_arrivals_read_tu" ON public.late_arrivals AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'TU'::role_type)));
DROP POLICY IF EXISTS "snapshot_owner_write" ON public.ld_context_snapshots;
CREATE POLICY "snapshot_owner_write" ON public.ld_context_snapshots AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((created_by = auth.uid()) AND (school_id = fn_current_school_id())))
  WITH CHECK (((created_by = auth.uid()) AND (school_id = fn_current_school_id())));
DROP POLICY IF EXISTS "snapshot_school_read" ON public.ld_context_snapshots;
CREATE POLICY "snapshot_school_read" ON public.ld_context_snapshots AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ((school_id = ( SELECT users.school_id
   FROM users
  WHERE (users.user_id = auth.uid()))));
DROP POLICY IF EXISTS "node_via_document" ON public.ld_document_nodes;
CREATE POLICY "node_via_document" ON public.ld_document_nodes AS PERMISSIVE FOR ALL TO PUBLIC
  USING (fn_ld_doc_owned_by_caller(document_id));
DROP POLICY IF EXISTS "tp_link_via_document" ON public.ld_document_tp_links;
CREATE POLICY "tp_link_via_document" ON public.ld_document_tp_links AS PERMISSIVE FOR ALL TO PUBLIC
  USING (fn_ld_doc_owned_by_caller(document_id));
DROP POLICY IF EXISTS "version_owner" ON public.ld_document_versions;
CREATE POLICY "version_owner" ON public.ld_document_versions AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((published_by = auth.uid()) AND fn_ld_doc_in_caller_school(document_id)));
DROP POLICY IF EXISTS "document_owner" ON public.ld_documents;
CREATE POLICY "document_owner" ON public.ld_documents AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((created_by = auth.uid()) AND (school_id = fn_current_school_id())))
  WITH CHECK (((created_by = auth.uid()) AND (school_id = fn_current_school_id())));
DROP POLICY IF EXISTS "document_school_read" ON public.ld_documents;
CREATE POLICY "document_school_read" ON public.ld_documents AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ((school_id = ( SELECT users.school_id
   FROM users
  WHERE (users.user_id = auth.uid()))));
DROP POLICY IF EXISTS "national_knowledge_read_all" ON public.ld_program_knowledge_national;
CREATE POLICY "national_knowledge_read_all" ON public.ld_program_knowledge_national AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS "school_knowledge_tenant" ON public.ld_program_knowledge_school;
CREATE POLICY "school_knowledge_tenant" ON public.ld_program_knowledge_school AS PERMISSIVE FOR ALL TO PUBLIC
  USING ((school_id = ( SELECT users.school_id
   FROM users
  WHERE (users.user_id = auth.uid()))));
DROP POLICY IF EXISTS "prompt_templates_read_authenticated" ON public.ld_prompt_templates;
CREATE POLICY "prompt_templates_read_authenticated" ON public.ld_prompt_templates AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS "teacher_knowledge_owner" ON public.ld_teacher_knowledge;
CREATE POLICY "teacher_knowledge_owner" ON public.ld_teacher_knowledge AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((teacher_id = auth.uid()) AND (fn_current_school_id() IS NOT NULL)));
DROP POLICY IF EXISTS "rls_lo_delete_guru" ON public.learning_objectives;
CREATE POLICY "rls_lo_delete_guru" ON public.learning_objectives AS PERMISSIVE FOR DELETE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id()) AND (fn_current_user_role() = 'GURU'::role_type)));
DROP POLICY IF EXISTS "rls_lo_insert_guru" ON public.learning_objectives;
CREATE POLICY "rls_lo_insert_guru" ON public.learning_objectives AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id()) AND (fn_current_user_role() = 'GURU'::role_type)));
DROP POLICY IF EXISTS "rls_lo_select_guru" ON public.learning_objectives;
CREATE POLICY "rls_lo_select_guru" ON public.learning_objectives AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'GURU'::role_type) AND (teacher_id = fn_current_user_id())));
DROP POLICY IF EXISTS "rls_lo_select_siswa" ON public.learning_objectives;
CREATE POLICY "rls_lo_select_siswa" ON public.learning_objectives AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'SISWA'::role_type) AND (EXISTS ( SELECT 1
   FROM class_enrollments ce
  WHERE ((ce.class_id = learning_objectives.class_id) AND (ce.student_id = fn_current_student_id()) AND (ce.withdrawn_at IS NULL))))));
DROP POLICY IF EXISTS "rls_lo_update_guru" ON public.learning_objectives;
CREATE POLICY "rls_lo_update_guru" ON public.learning_objectives AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id()) AND (fn_current_user_role() = 'GURU'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id())));
DROP POLICY IF EXISTS "rls_login_devices_read" ON public.login_devices;
CREATE POLICY "rls_login_devices_read" ON public.login_devices AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((user_id = fn_current_user_id()) AND (school_id = fn_current_school_id())));
DROP POLICY IF EXISTS "rls_notif_read" ON public.notifications;
CREATE POLICY "rls_notif_read" ON public.notifications AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((recipient_user_id = fn_current_user_id()) AND (school_id = fn_current_school_id())));
DROP POLICY IF EXISTS "rls_notif_update_read" ON public.notifications;
CREATE POLICY "rls_notif_update_read" ON public.notifications AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (((recipient_user_id = fn_current_user_id()) AND (school_id = fn_current_school_id())))
  WITH CHECK ((recipient_user_id = fn_current_user_id()));
DROP POLICY IF EXISTS "rls_observations_insert" ON public.observations;
CREATE POLICY "rls_observations_insert" ON public.observations AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (((school_id = fn_current_school_id()) AND (author_user_id = fn_current_user_id()) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.user_id = fn_current_user_id()) AND (NULLIF(btrim((u.teacher_code)::text), ''::text) IS NOT NULL)))) AND (visibility = ANY (ARRAY['SISWA_SAJA'::visibility_level, 'ORTU_SAJA'::visibility_level, 'SISWA_DAN_ORTU'::visibility_level, 'PRIVATE'::visibility_level])) AND fn_guru_teaches_student(student_id)));
DROP POLICY IF EXISTS "rls_observations_insert_dudi" ON public.observations;
CREATE POLICY "rls_observations_insert_dudi" ON public.observations AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'DUDI'::role_type) AND (author_user_id = fn_current_user_id()) AND (visibility = 'RESTRICTED'::visibility_level) AND (EXISTS ( SELECT 1
   FROM fn_dudi_placements() pp(placement_id, student_id, full_name, nis, start_date, end_date, is_active)
  WHERE ((pp.student_id = observations.student_id) AND (pp.is_active IS TRUE) AND ((((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta'::text))::date >= pp.start_date) AND (((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta'::text))::date <= pp.end_date)))))));
DROP POLICY IF EXISTS "rls_observations_read_dudi_own" ON public.observations;
CREATE POLICY "rls_observations_read_dudi_own" ON public.observations AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'DUDI'::role_type) AND (author_user_id = fn_current_user_id()) AND (visibility = 'RESTRICTED'::visibility_level) AND (is_void = false)));
DROP POLICY IF EXISTS "rls_observations_read_guru" ON public.observations;
CREATE POLICY "rls_observations_read_guru" ON public.observations AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (author_user_id = fn_current_user_id()) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.user_id = fn_current_user_id()) AND (NULLIF(btrim((u.teacher_code)::text), ''::text) IS NOT NULL))))));
DROP POLICY IF EXISTS "rls_observations_read_parent" ON public.observations;
CREATE POLICY "rls_observations_read_parent" ON public.observations AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ORTU'::role_type) AND (visibility = ANY (ARRAY['ORTU_SAJA'::visibility_level, 'SISWA_DAN_ORTU'::visibility_level])) AND (is_void = false) AND (EXISTS ( SELECT 1
   FROM student_parents sp
  WHERE ((sp.student_id = observations.student_id) AND (sp.parent_user_id = fn_current_user_id()))))));
DROP POLICY IF EXISTS "rls_observations_read_parent_restricted" ON public.observations;
CREATE POLICY "rls_observations_read_parent_restricted" ON public.observations AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((fn_current_user_role() = 'ORTU'::role_type) AND (visibility = 'RESTRICTED'::visibility_level) AND (is_void = false) AND (EXISTS ( SELECT 1
   FROM student_parents sp
  WHERE ((sp.student_id = observations.student_id) AND (sp.parent_user_id = fn_current_user_id()))))));
DROP POLICY IF EXISTS "rls_observations_read_pkl_supervisor" ON public.observations;
CREATE POLICY "rls_observations_read_pkl_supervisor" ON public.observations AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (visibility = 'RESTRICTED'::visibility_level) AND (is_void = false) AND ((fn_current_user_role() = 'KAPRODI'::role_type) OR fn_is_waka_humas())));
DROP POLICY IF EXISTS "rls_observations_read_student" ON public.observations;
CREATE POLICY "rls_observations_read_student" ON public.observations AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((fn_current_user_role() = 'SISWA'::role_type) AND (visibility = ANY (ARRAY['SISWA_SAJA'::visibility_level, 'SISWA_DAN_ORTU'::visibility_level])) AND (is_void = false) AND (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.student_id = observations.student_id) AND (s.user_id = fn_current_user_id()) AND (s.school_id = fn_current_school_id()))))));
DROP POLICY IF EXISTS "rls_observations_read_student_restricted" ON public.observations;
CREATE POLICY "rls_observations_read_student_restricted" ON public.observations AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((fn_current_user_role() = 'SISWA'::role_type) AND (visibility = 'RESTRICTED'::visibility_level) AND (is_void = false) AND (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.student_id = observations.student_id) AND (s.user_id = fn_current_user_id()) AND (s.school_id = fn_current_school_id()))))));
DROP POLICY IF EXISTS "rls_observations_update_author" ON public.observations;
CREATE POLICY "rls_observations_update_author" ON public.observations AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (author_user_id = fn_current_user_id()) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.user_id = fn_current_user_id()) AND (NULLIF(btrim((u.teacher_code)::text), ''::text) IS NOT NULL))))))
  WITH CHECK (((school_id = fn_current_school_id()) AND (author_user_id = fn_current_user_id()) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.user_id = fn_current_user_id()) AND (NULLIF(btrim((u.teacher_code)::text), ''::text) IS NOT NULL)))) AND (visibility = ANY (ARRAY['SISWA_SAJA'::visibility_level, 'ORTU_SAJA'::visibility_level, 'SISWA_DAN_ORTU'::visibility_level, 'PRIVATE'::visibility_level]))));
DROP POLICY IF EXISTS "rls_observations_void_admin" ON public.observations;
CREATE POLICY "rls_observations_void_admin" ON public.observations AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "rls_pkl_attendance_delete_administrative" ON public.pkl_attendance;
CREATE POLICY "rls_pkl_attendance_delete_administrative" ON public.pkl_attendance AS PERMISSIVE FOR DELETE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "rls_pkl_attendance_insert_dudi" ON public.pkl_attendance;
CREATE POLICY "rls_pkl_attendance_insert_dudi" ON public.pkl_attendance AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((school_id = fn_current_school_id()) AND (recorded_by_user_id = fn_current_user_id()) AND fn_dudi_can_record_attendance(placement_id, student_id, attendance_date)));
DROP POLICY IF EXISTS "rls_pkl_attendance_read_dudi" ON public.pkl_attendance;
CREATE POLICY "rls_pkl_attendance_read_dudi" ON public.pkl_attendance AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND fn_dudi_owns_placement(placement_id, student_id)));
DROP POLICY IF EXISTS "rls_pkl_attendance_read_guru" ON public.pkl_attendance;
CREATE POLICY "rls_pkl_attendance_read_guru" ON public.pkl_attendance AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'GURU'::role_type) AND fn_guru_supervises_pkl_student(student_id)));
DROP POLICY IF EXISTS "rls_pkl_attendance_read_kaprodi" ON public.pkl_attendance;
CREATE POLICY "rls_pkl_attendance_read_kaprodi" ON public.pkl_attendance AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'KAPRODI'::role_type) AND fn_kaprodi_of_student(student_id)));
DROP POLICY IF EXISTS "rls_pkl_attendance_read_kepsek" ON public.pkl_attendance;
CREATE POLICY "rls_pkl_attendance_read_kepsek" ON public.pkl_attendance AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'KEPSEK'::role_type)));
DROP POLICY IF EXISTS "rls_pkl_attendance_read_ortu" ON public.pkl_attendance;
CREATE POLICY "rls_pkl_attendance_read_ortu" ON public.pkl_attendance AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ORTU'::role_type) AND (EXISTS ( SELECT 1
   FROM student_parents sp
  WHERE ((sp.student_id = pkl_attendance.student_id) AND (sp.parent_user_id = fn_current_user_id()))))));
DROP POLICY IF EXISTS "rls_pkl_attendance_read_student" ON public.pkl_attendance;
CREATE POLICY "rls_pkl_attendance_read_student" ON public.pkl_attendance AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'SISWA'::role_type) AND (student_id = fn_current_student_id())));
DROP POLICY IF EXISTS "rls_pkl_attendance_read_waka_humas" ON public.pkl_attendance;
CREATE POLICY "rls_pkl_attendance_read_waka_humas" ON public.pkl_attendance AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'WAKA_HUMAS'::role_type)));
DROP POLICY IF EXISTS "rls_pkl_attendance_update_dudi" ON public.pkl_attendance;
CREATE POLICY "rls_pkl_attendance_update_dudi" ON public.pkl_attendance AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((school_id = fn_current_school_id()) AND fn_dudi_owns_placement(placement_id, student_id)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (recorded_by_user_id = fn_current_user_id()) AND fn_dudi_can_record_attendance(placement_id, student_id, attendance_date)));
DROP POLICY IF EXISTS "rls_pkl_read_dudi" ON public.pkl_placements;
CREATE POLICY "rls_pkl_read_dudi" ON public.pkl_placements AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'DUDI'::role_type) AND (dudi_user_id = fn_current_user_id())));
DROP POLICY IF EXISTS "rls_pkl_read_guru" ON public.pkl_placements;
CREATE POLICY "rls_pkl_read_guru" ON public.pkl_placements AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'GURU'::role_type) AND (guru_pembimbing_user_id = fn_current_user_id())));
DROP POLICY IF EXISTS "rls_pkl_read_kaprodi" ON public.pkl_placements;
CREATE POLICY "rls_pkl_read_kaprodi" ON public.pkl_placements AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'KAPRODI'::role_type) AND fn_kaprodi_of_student(student_id)));
DROP POLICY IF EXISTS "rls_pkl_read_kepsek" ON public.pkl_placements;
CREATE POLICY "rls_pkl_read_kepsek" ON public.pkl_placements AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'KEPSEK'::role_type)));
DROP POLICY IF EXISTS "rls_pkl_read_ortu" ON public.pkl_placements;
CREATE POLICY "rls_pkl_read_ortu" ON public.pkl_placements AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ORTU'::role_type) AND (EXISTS ( SELECT 1
   FROM student_parents sp
  WHERE ((sp.student_id = pkl_placements.student_id) AND (sp.parent_user_id = fn_current_user_id()))))));
DROP POLICY IF EXISTS "rls_pkl_read_student" ON public.pkl_placements;
CREATE POLICY "rls_pkl_read_student" ON public.pkl_placements AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'SISWA'::role_type) AND (student_id = fn_current_student_id())));
DROP POLICY IF EXISTS "rls_pkl_read_waka_humas" ON public.pkl_placements;
CREATE POLICY "rls_pkl_read_waka_humas" ON public.pkl_placements AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND fn_is_waka_humas()));
DROP POLICY IF EXISTS "rls_pkl_write_admin" ON public.pkl_placements;
CREATE POLICY "rls_pkl_write_admin" ON public.pkl_placements AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KAPRODI'::role_type, 'KEPSEK'::role_type]))))
  WITH CHECK ((school_id = fn_current_school_id()));
DROP POLICY IF EXISTS "rls_pkl_write_administrative" ON public.pkl_placements;
CREATE POLICY "rls_pkl_write_administrative" ON public.pkl_placements AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "rls_programs_read_all" ON public.programs;
CREATE POLICY "rls_programs_read_all" ON public.programs AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (auth.uid() IS NOT NULL)));
DROP POLICY IF EXISTS "rls_programs_write_admin" ON public.programs;
CREATE POLICY "rls_programs_write_admin" ON public.programs AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KEPSEK'::role_type, 'KAPRODI'::role_type, 'ADMINISTRATIVE'::role_type]))))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KEPSEK'::role_type, 'KAPRODI'::role_type, 'ADMINISTRATIVE'::role_type]))));
DROP POLICY IF EXISTS "pt_select" ON public.prompt_templates;
CREATE POLICY "pt_select" ON public.prompt_templates AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS "rls_reapply_jobs_administrative" ON public.schedule_reapply_jobs;
CREATE POLICY "rls_reapply_jobs_administrative" ON public.schedule_reapply_jobs AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "rls_reapply_targets_administrative" ON public.schedule_reapply_targets;
CREATE POLICY "rls_reapply_targets_administrative" ON public.schedule_reapply_targets AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "rls_schedule_templates_read_administrative" ON public.schedule_templates;
CREATE POLICY "rls_schedule_templates_read_administrative" ON public.schedule_templates AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "rls_schedule_templates_read_staff" ON public.schedule_templates;
CREATE POLICY "rls_schedule_templates_read_staff" ON public.schedule_templates AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type, 'KAPRODI'::role_type, 'KEPSEK'::role_type]))));
DROP POLICY IF EXISTS "rls_schedule_templates_write_administrative" ON public.schedule_templates;
CREATE POLICY "rls_schedule_templates_write_administrative" ON public.schedule_templates AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "rls_time_slots_read" ON public.schedule_time_slots;
CREATE POLICY "rls_time_slots_read" ON public.schedule_time_slots AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "rls_time_slots_write" ON public.schedule_time_slots;
CREATE POLICY "rls_time_slots_write" ON public.schedule_time_slots AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "rls_school_config_read_all" ON public.school_config;
CREATE POLICY "rls_school_config_read_all" ON public.school_config AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (auth.uid() IS NOT NULL)));
DROP POLICY IF EXISTS "rls_school_config_write_admin" ON public.school_config;
CREATE POLICY "rls_school_config_write_admin" ON public.school_config AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['ADMINISTRATIVE'::role_type, 'KEPSEK'::role_type]))))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['ADMINISTRATIVE'::role_type, 'KEPSEK'::role_type]))));
DROP POLICY IF EXISTS "rls_schools_read_own" ON public.schools;
CREATE POLICY "rls_schools_read_own" ON public.schools AS PERMISSIVE FOR SELECT TO authenticated
  USING ((school_id = ( SELECT users.school_id
   FROM users
  WHERE (users.auth_user_id = auth.uid())
 LIMIT 1)));
DROP POLICY IF EXISTS "rls_exits_delete_own" ON public.student_exits;
CREATE POLICY "rls_exits_delete_own" ON public.student_exits AS PERMISSIVE FOR DELETE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (recorded_by = fn_current_user_id()) AND fn_is_on_duty_today()));
DROP POLICY IF EXISTS "rls_exits_insert_piket" ON public.student_exits;
CREATE POLICY "rls_exits_insert_piket" ON public.student_exits AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (((school_id = fn_current_school_id()) AND fn_student_in_current_school(student_id) AND (recorded_by = fn_current_user_id()) AND fn_is_on_duty_today() AND (exit_date = ((now() AT TIME ZONE 'Asia/Jakarta'::text))::date)));
DROP POLICY IF EXISTS "rls_exits_read_parent" ON public.student_exits;
CREATE POLICY "rls_exits_read_parent" ON public.student_exits AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (EXISTS ( SELECT 1
   FROM student_parents sp
  WHERE ((sp.student_id = student_exits.student_id) AND (sp.parent_user_id = fn_current_user_id()) AND (sp.school_id = fn_current_school_id()))))));
DROP POLICY IF EXISTS "rls_exits_read_piket" ON public.student_exits;
CREATE POLICY "rls_exits_read_piket" ON public.student_exits AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (exit_date = ((now() AT TIME ZONE 'Asia/Jakarta'::text))::date) AND fn_is_on_duty_today()));
DROP POLICY IF EXISTS "rls_exits_read_student" ON public.student_exits;
CREATE POLICY "rls_exits_read_student" ON public.student_exits AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (student_id = ( SELECT s.student_id
   FROM students s
  WHERE (s.user_id = fn_current_user_id())
 LIMIT 1))));
DROP POLICY IF EXISTS "rls_exits_read_tu" ON public.student_exits;
CREATE POLICY "rls_exits_read_tu" ON public.student_exits AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'TU'::role_type)));
DROP POLICY IF EXISTS "rls_exits_read_waka" ON public.student_exits;
CREATE POLICY "rls_exits_read_waka" ON public.student_exits AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['WAKA_KESISWAAN'::role_type, 'KEPSEK'::role_type]))));
DROP POLICY IF EXISTS "rls_exits_update_own" ON public.student_exits;
CREATE POLICY "rls_exits_update_own" ON public.student_exits AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (recorded_by = fn_current_user_id()) AND fn_is_on_duty_today()))
  WITH CHECK (((school_id = fn_current_school_id()) AND (recorded_by = fn_current_user_id())));
DROP POLICY IF EXISTS "rls_student_grades_delete_guru" ON public.student_grades;
CREATE POLICY "rls_student_grades_delete_guru" ON public.student_grades AS PERMISSIVE FOR DELETE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id()) AND (fn_current_user_role() = 'GURU'::role_type)));
DROP POLICY IF EXISTS "rls_student_grades_insert_guru" ON public.student_grades;
CREATE POLICY "rls_student_grades_insert_guru" ON public.student_grades AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id()) AND (fn_current_user_role() = 'GURU'::role_type)));
DROP POLICY IF EXISTS "rls_student_grades_select_guru" ON public.student_grades;
CREATE POLICY "rls_student_grades_select_guru" ON public.student_grades AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'GURU'::role_type)));
DROP POLICY IF EXISTS "rls_student_grades_select_kaprodi" ON public.student_grades;
CREATE POLICY "rls_student_grades_select_kaprodi" ON public.student_grades AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (is_published = true) AND (fn_current_user_role() = 'KAPRODI'::role_type) AND (fn_kaprodi_program_id() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.student_id = student_grades.student_id) AND (s.program_id = fn_kaprodi_program_id()))))));
DROP POLICY IF EXISTS "rls_student_grades_select_kepsek_waka" ON public.student_grades;
CREATE POLICY "rls_student_grades_select_kepsek_waka" ON public.student_grades AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KEPSEK'::role_type, 'WAKA_KURIKULUM'::role_type]))));
DROP POLICY IF EXISTS "rls_student_grades_select_ortu" ON public.student_grades;
CREATE POLICY "rls_student_grades_select_ortu" ON public.student_grades AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (is_published = true) AND (fn_current_user_role() = 'ORTU'::role_type) AND (EXISTS ( SELECT 1
   FROM student_parents sp
  WHERE ((sp.parent_user_id = fn_current_user_id()) AND (sp.student_id = student_grades.student_id) AND (sp.school_id = fn_current_school_id()))))));
DROP POLICY IF EXISTS "rls_student_grades_select_siswa" ON public.student_grades;
CREATE POLICY "rls_student_grades_select_siswa" ON public.student_grades AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (is_published = true) AND (student_id = fn_current_student_id()) AND (fn_current_user_role() = 'SISWA'::role_type)));
DROP POLICY IF EXISTS "rls_student_grades_select_wali" ON public.student_grades;
CREATE POLICY "rls_student_grades_select_wali" ON public.student_grades AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (is_published = true) AND (fn_current_user_role() = 'WALI_KELAS'::role_type) AND (fn_wali_kelas_class_id() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM class_enrollments ce
  WHERE ((ce.student_id = student_grades.student_id) AND (ce.class_id = fn_wali_kelas_class_id()) AND (ce.withdrawn_at IS NULL))))));
DROP POLICY IF EXISTS "rls_student_grades_update_guru" ON public.student_grades;
CREATE POLICY "rls_student_grades_update_guru" ON public.student_grades AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id()) AND (fn_current_user_role() = 'GURU'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id())));
DROP POLICY IF EXISTS "rls_student_groups_delete_pengajar" ON public.student_groups;
CREATE POLICY "rls_student_groups_delete_pengajar" ON public.student_groups AS PERMISSIVE FOR DELETE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND fn_teaches_class(class_id)));
DROP POLICY IF EXISTS "rls_student_groups_insert_pengajar" ON public.student_groups;
CREATE POLICY "rls_student_groups_insert_pengajar" ON public.student_groups AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (((school_id = fn_current_school_id()) AND fn_teaches_class(class_id)));
DROP POLICY IF EXISTS "rls_student_groups_update_pengajar" ON public.student_groups;
CREATE POLICY "rls_student_groups_update_pengajar" ON public.student_groups AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND fn_teaches_class(class_id)))
  WITH CHECK (((school_id = fn_current_school_id()) AND fn_teaches_class(class_id)));
DROP POLICY IF EXISTS "student_groups_school_read" ON public.student_groups;
CREATE POLICY "student_groups_school_read" ON public.student_groups AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ((school_id = fn_current_school_id()));
DROP POLICY IF EXISTS "rls_student_parents_read_administrative" ON public.student_parents;
CREATE POLICY "rls_student_parents_read_administrative" ON public.student_parents AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "rls_student_parents_read_own" ON public.student_parents;
CREATE POLICY "rls_student_parents_read_own" ON public.student_parents AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ORTU'::role_type) AND (parent_user_id = fn_current_user_id())));
DROP POLICY IF EXISTS "rls_student_parents_write_administrative" ON public.student_parents;
CREATE POLICY "rls_student_parents_write_administrative" ON public.student_parents AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "rls_student_updates_read_staff" ON public.student_updates;
CREATE POLICY "rls_student_updates_read_staff" ON public.student_updates AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type, 'KAPRODI'::role_type, 'KEPSEK'::role_type, 'DUDI'::role_type]))));
DROP POLICY IF EXISTS "rls_students_read_administrative" ON public.students;
CREATE POLICY "rls_students_read_administrative" ON public.students AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "rls_students_read_dudi" ON public.students;
CREATE POLICY "rls_students_read_dudi" ON public.students AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'DUDI'::role_type) AND fn_dudi_supervises_student(student_id)));
DROP POLICY IF EXISTS "rls_students_read_own" ON public.students;
CREATE POLICY "rls_students_read_own" ON public.students AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'SISWA'::role_type) AND (user_id = fn_current_user_id())));
DROP POLICY IF EXISTS "rls_students_read_parent" ON public.students;
CREATE POLICY "rls_students_read_parent" ON public.students AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ORTU'::role_type) AND (EXISTS ( SELECT 1
   FROM student_parents sp
  WHERE ((sp.student_id = students.student_id) AND (sp.parent_user_id = fn_current_user_id()))))));
DROP POLICY IF EXISTS "rls_students_read_piket" ON public.students;
CREATE POLICY "rls_students_read_piket" ON public.students AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND fn_is_on_duty_today()));
DROP POLICY IF EXISTS "rls_students_read_staff" ON public.students;
CREATE POLICY "rls_students_read_staff" ON public.students AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND fn_can_see_student(student_id)));
DROP POLICY IF EXISTS "rls_students_read_tu" ON public.students;
CREATE POLICY "rls_students_read_tu" ON public.students AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'TU'::role_type)));
DROP POLICY IF EXISTS "rls_students_read_waka_humas_pkl" ON public.students;
CREATE POLICY "rls_students_read_waka_humas_pkl" ON public.students AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (student_status = 'PKL'::student_status) AND fn_is_waka_humas()));
DROP POLICY IF EXISTS "rls_students_write_admin" ON public.students;
CREATE POLICY "rls_students_write_admin" ON public.students AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_is_kepsek() OR (program_id = fn_kaprodi_program_id()))))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_is_kepsek() OR (program_id = fn_kaprodi_program_id()))));
DROP POLICY IF EXISTS "rls_students_write_administrative" ON public.students;
CREATE POLICY "rls_students_write_administrative" ON public.students AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "sca_delete" ON public.subject_code_aliases;
CREATE POLICY "sca_delete" ON public.subject_code_aliases AS PERMISSIVE FOR DELETE TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "sca_insert" ON public.subject_code_aliases;
CREATE POLICY "sca_insert" ON public.subject_code_aliases AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "sca_select" ON public.subject_code_aliases;
CREATE POLICY "sca_select" ON public.subject_code_aliases AS PERMISSIVE FOR SELECT TO authenticated
  USING ((school_id = fn_current_school_id()));
DROP POLICY IF EXISTS "sca_update" ON public.subject_code_aliases;
CREATE POLICY "sca_update" ON public.subject_code_aliases AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "scm_insert" ON public.subject_cp_mapping;
CREATE POLICY "scm_insert" ON public.subject_cp_mapping AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((school_id = fn_current_school_id()));
DROP POLICY IF EXISTS "scm_select" ON public.subject_cp_mapping;
CREATE POLICY "scm_select" ON public.subject_cp_mapping AS PERMISSIVE FOR SELECT TO authenticated
  USING ((school_id = fn_current_school_id()));
DROP POLICY IF EXISTS "scm_update" ON public.subject_cp_mapping;
CREATE POLICY "scm_update" ON public.subject_cp_mapping AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((school_id = fn_current_school_id()));
DROP POLICY IF EXISTS "rls_subjects_read_all" ON public.subjects;
CREATE POLICY "rls_subjects_read_all" ON public.subjects AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (auth.uid() IS NOT NULL)));
DROP POLICY IF EXISTS "rls_subjects_write_admin" ON public.subjects;
CREATE POLICY "rls_subjects_write_admin" ON public.subjects AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KEPSEK'::role_type, 'KAPRODI'::role_type]))))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KEPSEK'::role_type, 'KAPRODI'::role_type]))));
DROP POLICY IF EXISTS "rls_substitute_read_own" ON public.substitute_schedules;
CREATE POLICY "rls_substitute_read_own" ON public.substitute_schedules AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (substitute_user_id = fn_current_user_id())));
DROP POLICY IF EXISTS "rls_substitute_write_admin" ON public.substitute_schedules;
CREATE POLICY "rls_substitute_write_admin" ON public.substitute_schedules AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KAPRODI'::role_type, 'KEPSEK'::role_type]))))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KAPRODI'::role_type, 'KEPSEK'::role_type]))));
DROP POLICY IF EXISTS "rls_substitute_write_administrative" ON public.substitute_schedules;
CREATE POLICY "rls_substitute_write_administrative" ON public.substitute_schedules AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "rls_teacher_att_log_read_own" ON public.teacher_attendance_log;
CREATE POLICY "rls_teacher_att_log_read_own" ON public.teacher_attendance_log AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND ((user_id = fn_current_user_id()) OR (fn_current_user_role() = 'KEPSEK'::role_type))));
DROP POLICY IF EXISTS "tda_delete" ON public.teacher_document_approvals;
CREATE POLICY "tda_delete" ON public.teacher_document_approvals AS PERMISSIVE FOR DELETE TO authenticated
  USING (((school_id = fn_current_school_id()) AND (doc_id IN ( SELECT teacher_documents.doc_id
   FROM teacher_documents
  WHERE ((teacher_documents.teacher_user_id = auth.uid()) AND ((teacher_documents.status)::text <> 'DISAHKAN_WAKA'::text))))));
DROP POLICY IF EXISTS "tda_insert" ON public.teacher_document_approvals;
CREATE POLICY "tda_insert" ON public.teacher_document_approvals AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (((school_id = fn_current_school_id()) AND fn_is_kepsek()));
DROP POLICY IF EXISTS "tda_select" ON public.teacher_document_approvals;
CREATE POLICY "tda_select" ON public.teacher_document_approvals AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ((school_id = fn_current_school_id()));
DROP POLICY IF EXISTS "tdc_delete" ON public.teacher_document_classes;
CREATE POLICY "tdc_delete" ON public.teacher_document_classes AS PERMISSIVE FOR DELETE TO PUBLIC
  USING ((school_id = fn_current_school_id()));
DROP POLICY IF EXISTS "tdc_insert" ON public.teacher_document_classes;
CREATE POLICY "tdc_insert" ON public.teacher_document_classes AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK ((school_id = fn_current_school_id()));
DROP POLICY IF EXISTS "tdc_select" ON public.teacher_document_classes;
CREATE POLICY "tdc_select" ON public.teacher_document_classes AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ((school_id = fn_current_school_id()));
DROP POLICY IF EXISTS "td_delete" ON public.teacher_documents;
CREATE POLICY "td_delete" ON public.teacher_documents AS PERMISSIVE FOR DELETE TO authenticated
  USING (((school_id = fn_current_school_id()) AND (teacher_user_id = auth.uid()) AND ((status)::text <> 'DISAHKAN_WAKA'::text)));
DROP POLICY IF EXISTS "td_insert" ON public.teacher_documents;
CREATE POLICY "td_insert" ON public.teacher_documents AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (((school_id = fn_current_school_id()) AND (teacher_user_id = auth.uid())));
DROP POLICY IF EXISTS "td_select" ON public.teacher_documents;
CREATE POLICY "td_select" ON public.teacher_documents AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND ((teacher_user_id = auth.uid()) OR fn_is_kepsek() OR fn_is_waka_kurikulum())));
DROP POLICY IF EXISTS "td_update" ON public.teacher_documents;
CREATE POLICY "td_update" ON public.teacher_documents AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (teacher_user_id = auth.uid())));
DROP POLICY IF EXISTS "rls_journals_owner" ON public.teacher_journals;
CREATE POLICY "rls_journals_owner" ON public.teacher_journals AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (owner_user_id = fn_current_user_id())))
  WITH CHECK (((school_id = fn_current_school_id()) AND (owner_user_id = fn_current_user_id())));
DROP POLICY IF EXISTS "rls_piket_admin_write" ON public.teacher_piket_assignments;
CREATE POLICY "rls_piket_admin_write" ON public.teacher_piket_assignments AS PERMISSIVE FOR ALL TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.school_id = fn_current_school_id()) AND (users.role_type = 'ADMINISTRATIVE'::role_type)))));
DROP POLICY IF EXISTS "rls_piket_select" ON public.teacher_piket_assignments;
CREATE POLICY "rls_piket_select" ON public.teacher_piket_assignments AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ((school_id = fn_current_school_id()));
DROP POLICY IF EXISTS "tp_insert" ON public.teacher_profiles;
CREATE POLICY "tp_insert" ON public.teacher_profiles AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (((school_id = fn_current_school_id()) AND (teacher_user_id = auth.uid())));
DROP POLICY IF EXISTS "tp_select" ON public.teacher_profiles;
CREATE POLICY "tp_select" ON public.teacher_profiles AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (teacher_user_id = auth.uid())));
DROP POLICY IF EXISTS "tp_update" ON public.teacher_profiles;
CREATE POLICY "tp_update" ON public.teacher_profiles AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (teacher_user_id = auth.uid())));
DROP POLICY IF EXISTS "rls_assignments_read_administrative" ON public.teaching_assignments;
CREATE POLICY "rls_assignments_read_administrative" ON public.teaching_assignments AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "rls_assignments_read_own" ON public.teaching_assignments;
CREATE POLICY "rls_assignments_read_own" ON public.teaching_assignments AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (user_id = fn_current_user_id()) AND (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.user_id = fn_current_user_id()) AND (users.teacher_code IS NOT NULL) AND ((users.teacher_code)::text <> ''::text))))));
DROP POLICY IF EXISTS "rls_assignments_write_admin" ON public.teaching_assignments;
CREATE POLICY "rls_assignments_write_admin" ON public.teaching_assignments AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KAPRODI'::role_type, 'KEPSEK'::role_type]))))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KAPRODI'::role_type, 'KEPSEK'::role_type]))));
DROP POLICY IF EXISTS "rls_assignments_write_administrative" ON public.teaching_assignments;
CREATE POLICY "rls_assignments_write_administrative" ON public.teaching_assignments AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "tc_insert" ON public.teaching_contexts;
CREATE POLICY "tc_insert" ON public.teaching_contexts AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (((school_id = fn_current_school_id()) AND (teacher_user_id = auth.uid())));
DROP POLICY IF EXISTS "tc_select" ON public.teaching_contexts;
CREATE POLICY "tc_select" ON public.teaching_contexts AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (teacher_user_id = auth.uid())));
DROP POLICY IF EXISTS "tc_update" ON public.teaching_contexts;
CREATE POLICY "tc_update" ON public.teaching_contexts AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (teacher_user_id = auth.uid())));
DROP POLICY IF EXISTS "rls_tcp_delete" ON public.teaching_cp;
CREATE POLICY "rls_tcp_delete" ON public.teaching_cp AS PERMISSIVE FOR DELETE TO authenticated
  USING (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id()) AND (fn_current_user_role() = 'GURU'::role_type)));
DROP POLICY IF EXISTS "rls_tcp_insert" ON public.teaching_cp;
CREATE POLICY "rls_tcp_insert" ON public.teaching_cp AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id()) AND (fn_current_user_role() = 'GURU'::role_type)));
DROP POLICY IF EXISTS "rls_tcp_select" ON public.teaching_cp;
CREATE POLICY "rls_tcp_select" ON public.teaching_cp AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id()) AND (fn_current_user_role() = 'GURU'::role_type)));
DROP POLICY IF EXISTS "rls_tcp_update" ON public.teaching_cp;
CREATE POLICY "rls_tcp_update" ON public.teaching_cp AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id()) AND (fn_current_user_role() = 'GURU'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id()) AND (fn_current_user_role() = 'GURU'::role_type)));
DROP POLICY IF EXISTS "rls_tce_delete" ON public.teaching_cp_elements;
CREATE POLICY "rls_tce_delete" ON public.teaching_cp_elements AS PERMISSIVE FOR DELETE TO authenticated
  USING (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id()) AND (fn_current_user_role() = 'GURU'::role_type)));
DROP POLICY IF EXISTS "rls_tce_insert" ON public.teaching_cp_elements;
CREATE POLICY "rls_tce_insert" ON public.teaching_cp_elements AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id()) AND (fn_current_user_role() = 'GURU'::role_type)));
DROP POLICY IF EXISTS "rls_tce_select" ON public.teaching_cp_elements;
CREATE POLICY "rls_tce_select" ON public.teaching_cp_elements AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id()) AND (fn_current_user_role() = 'GURU'::role_type)));
DROP POLICY IF EXISTS "rls_tce_update" ON public.teaching_cp_elements;
CREATE POLICY "rls_tce_update" ON public.teaching_cp_elements AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id()) AND (fn_current_user_role() = 'GURU'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (teacher_id = fn_current_user_id()) AND (fn_current_user_role() = 'GURU'::role_type)));
DROP POLICY IF EXISTS "rls_schedules_read_administrative" ON public.teaching_schedules;
CREATE POLICY "rls_schedules_read_administrative" ON public.teaching_schedules AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "rls_schedules_read_own" ON public.teaching_schedules;
CREATE POLICY "rls_schedules_read_own" ON public.teaching_schedules AS PERMISSIVE FOR SELECT TO authenticated
  USING (((school_id = fn_current_school_id()) AND (scheduled_teacher_id = fn_current_user_id()) AND (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.user_id = fn_current_user_id()) AND (users.teacher_code IS NOT NULL) AND ((users.teacher_code)::text <> ''::text))))));
DROP POLICY IF EXISTS "rls_schedules_read_parent" ON public.teaching_schedules;
CREATE POLICY "rls_schedules_read_parent" ON public.teaching_schedules AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ORTU'::role_type) AND (EXISTS ( SELECT 1
   FROM (class_enrollments ce
     JOIN student_parents sp ON ((sp.student_id = ce.student_id)))
  WHERE ((ce.class_id = teaching_schedules.class_id) AND (ce.school_id = fn_current_school_id()) AND (ce.withdrawn_at IS NULL) AND (sp.parent_user_id = fn_current_user_id()))))));
DROP POLICY IF EXISTS "rls_schedules_read_student" ON public.teaching_schedules;
CREATE POLICY "rls_schedules_read_student" ON public.teaching_schedules AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'SISWA'::role_type) AND (EXISTS ( SELECT 1
   FROM class_enrollments ce
  WHERE ((ce.class_id = teaching_schedules.class_id) AND (ce.student_id = fn_current_student_id()) AND (ce.school_id = fn_current_school_id()) AND (ce.withdrawn_at IS NULL))))));
DROP POLICY IF EXISTS "rls_schedules_read_tu" ON public.teaching_schedules;
CREATE POLICY "rls_schedules_read_tu" ON public.teaching_schedules AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'TU'::role_type)));
DROP POLICY IF EXISTS "rls_schedules_write_admin" ON public.teaching_schedules;
CREATE POLICY "rls_schedules_write_admin" ON public.teaching_schedules AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KAPRODI'::role_type, 'KEPSEK'::role_type]))))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KAPRODI'::role_type, 'KEPSEK'::role_type]))));
DROP POLICY IF EXISTS "rls_schedules_write_administrative" ON public.teaching_schedules;
CREATE POLICY "rls_schedules_write_administrative" ON public.teaching_schedules AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "tp_taught_status_insert" ON public.tp_taught_status;
CREATE POLICY "tp_taught_status_insert" ON public.tp_taught_status AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((teacher_id = fn_current_user_id()) AND (school_id = fn_current_school_id())));
DROP POLICY IF EXISTS "tp_taught_status_select" ON public.tp_taught_status;
CREATE POLICY "tp_taught_status_select" ON public.tp_taught_status AS PERMISSIVE FOR SELECT TO authenticated
  USING (((teacher_id = fn_current_user_id()) AND (school_id = fn_current_school_id())));
DROP POLICY IF EXISTS "tp_taught_status_update" ON public.tp_taught_status;
CREATE POLICY "tp_taught_status_update" ON public.tp_taught_status AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((teacher_id = fn_current_user_id()) AND (school_id = fn_current_school_id())))
  WITH CHECK (((teacher_id = fn_current_user_id()) AND (school_id = fn_current_school_id())));
DROP POLICY IF EXISTS "rls_tp_read" ON public.tujuan_pembelajaran;
CREATE POLICY "rls_tp_read" ON public.tujuan_pembelajaran AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ((school_id = fn_current_school_id()));
DROP POLICY IF EXISTS "rls_tp_write" ON public.tujuan_pembelajaran;
CREATE POLICY "rls_tp_write" ON public.tujuan_pembelajaran AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['ADMINISTRATIVE'::role_type, 'GURU'::role_type, 'WALI_KELAS'::role_type, 'BK'::role_type, 'KAPRODI'::role_type, 'WAKA_KURIKULUM'::role_type, 'WAKA_KESISWAAN'::role_type, 'WAKA_HUMAS'::role_type, 'KEPSEK'::role_type]))));
DROP POLICY IF EXISTS "rls_users_read_administrative" ON public.users;
CREATE POLICY "rls_users_read_administrative" ON public.users AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "rls_users_read_own" ON public.users;
CREATE POLICY "rls_users_read_own" ON public.users AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((auth_user_id = auth.uid()) AND (school_id = fn_current_school_id())));
DROP POLICY IF EXISTS "rls_users_read_staff" ON public.users;
CREATE POLICY "rls_users_read_staff" ON public.users AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (((fn_current_user_role() = ANY (ARRAY['GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type, 'KAPRODI'::role_type, 'KEPSEK'::role_type, 'WAKA_KURIKULUM'::role_type, 'WAKA_KESISWAAN'::role_type, 'WAKA_HUMAS'::role_type, 'ADMINISTRATIVE'::role_type])) AND (role_type = ANY (ARRAY['GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type, 'KAPRODI'::role_type, 'KEPSEK'::role_type, 'WAKA_KURIKULUM'::role_type, 'WAKA_KESISWAAN'::role_type, 'WAKA_HUMAS'::role_type, 'DUDI'::role_type, 'ADMINISTRATIVE'::role_type]))) OR (auth_user_id = auth.uid()) OR ((fn_current_user_role() = ANY (ARRAY['GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type, 'KAPRODI'::role_type, 'KEPSEK'::role_type, 'WAKA_KURIKULUM'::role_type, 'WAKA_KESISWAAN'::role_type, 'WAKA_HUMAS'::role_type, 'ADMINISTRATIVE'::role_type])) AND (role_type = ANY (ARRAY['SISWA'::role_type, 'ORTU'::role_type]))))));
DROP POLICY IF EXISTS "rls_users_read_tu" ON public.users;
CREATE POLICY "rls_users_read_tu" ON public.users AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'TU'::role_type)));
DROP POLICY IF EXISTS "rls_users_read_waka" ON public.users;
CREATE POLICY "rls_users_read_waka" ON public.users AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['WAKA_KURIKULUM'::role_type, 'WAKA_KESISWAAN'::role_type]))));
DROP POLICY IF EXISTS "rls_users_update_own" ON public.users;
CREATE POLICY "rls_users_update_own" ON public.users AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING ((auth_user_id = auth.uid()))
  WITH CHECK (((auth_user_id = auth.uid()) AND (school_id = fn_current_school_id())));
DROP POLICY IF EXISTS "rls_users_write_administrative" ON public.users;
CREATE POLICY "rls_users_write_administrative" ON public.users AS PERMISSIVE FOR ALL TO PUBLIC
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));
DROP POLICY IF EXISTS "forum_attachments_delete" ON storage.objects;
CREATE POLICY "forum_attachments_delete" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (((bucket_id = 'forum-attachments'::text) AND ((storage.foldername(name))[1] = (fn_current_school_id())::text) AND ((owner_id = (auth.uid())::text) OR fn_forum_attachment_moderator())));
DROP POLICY IF EXISTS "forum_attachments_download" ON storage.objects;
CREATE POLICY "forum_attachments_download" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (((bucket_id = 'forum-attachments'::text) AND ((storage.foldername(name))[1] = (fn_current_school_id())::text) AND (fn_forum_attachment_moderator() OR fn_forum_attachment_readable(name))));
DROP POLICY IF EXISTS "forum_attachments_upload" ON storage.objects;
CREATE POLICY "forum_attachments_upload" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = 'forum-attachments'::text) AND ((storage.foldername(name))[1] = (fn_current_school_id())::text)));

-- ============================================================
-- Hak akses (diturunkan dari status efektif di database sumber)
-- ============================================================
GRANT USAGE ON SCHEMA core TO authenticated;
GRANT USAGE ON SCHEMA core TO service_role;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;
REVOKE ALL ON TABLE core.capaian_pembelajaran FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE core.capaian_pembelajaran TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE core.capaian_pembelajaran TO service_role;
REVOKE ALL ON TABLE core.cp_elements FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE core.cp_elements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE core.cp_elements TO service_role;
REVOKE ALL ON TABLE core.curriculum_versions FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE core.curriculum_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE core.curriculum_versions TO service_role;
REVOKE ALL ON TABLE core.education_levels FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE core.education_levels TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE core.education_levels TO service_role;
REVOKE ALL ON TABLE core.knowledge_national FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE core.knowledge_national TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE core.knowledge_national TO service_role;
REVOKE ALL ON TABLE core.phases FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE core.phases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE core.phases TO service_role;
REVOKE ALL ON TABLE core.subject_name_mapping FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE core.subject_name_mapping TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE core.subject_name_mapping TO service_role;
REVOKE ALL ON TABLE core.subject_phases FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE core.subject_phases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE core.subject_phases TO service_role;
REVOKE ALL ON TABLE core.subjects FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE core.subjects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE core.subjects TO service_role;
REVOKE ALL ON TABLE core.vocational_concentrations FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE core.vocational_concentrations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE core.vocational_concentrations TO service_role;
REVOKE ALL ON TABLE core.vocational_fields FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE core.vocational_fields TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE core.vocational_fields TO service_role;
REVOKE ALL ON TABLE core.vocational_programs FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE core.vocational_programs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE core.vocational_programs TO service_role;
REVOKE ALL ON TABLE public.academic_periods FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.academic_periods TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.academic_periods TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.academic_periods TO service_role;
REVOKE ALL ON TABLE public.assessment_criteria FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.assessment_criteria TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.assessment_criteria TO service_role;
REVOKE ALL ON TABLE public.assessment_results FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.assessment_results TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.assessment_results TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.assessment_results TO service_role;
REVOKE ALL ON TABLE public.assessment_rubric_criteria FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.assessment_rubric_criteria TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.assessment_rubric_criteria TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.assessment_rubric_criteria TO service_role;
REVOKE ALL ON TABLE public.assessment_rubric_results FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.assessment_rubric_results TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.assessment_rubric_results TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.assessment_rubric_results TO service_role;
REVOKE ALL ON TABLE public.assessments FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.assessments TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.assessments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.assessments TO service_role;
REVOKE ALL ON TABLE public.attendance FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.attendance TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.attendance TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.attendance TO service_role;
REVOKE ALL ON TABLE public.audit_log FROM anon, authenticated, service_role;
GRANT SELECT, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.audit_log TO anon;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.audit_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.audit_log TO service_role;
REVOKE ALL ON SEQUENCE public.audit_log_id_seq FROM anon, authenticated, service_role;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.audit_log_id_seq TO anon;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.audit_log_id_seq TO authenticated;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.audit_log_id_seq TO service_role;
REVOKE ALL ON TABLE public.bk_class_assignments FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.bk_class_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.bk_class_assignments TO service_role;
REVOKE ALL ON TABLE public.capaian_pembelajaran FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.capaian_pembelajaran TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.capaian_pembelajaran TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.capaian_pembelajaran TO service_role;
REVOKE ALL ON TABLE public.class_enrollments FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.class_enrollments TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.class_enrollments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.class_enrollments TO service_role;
REVOKE ALL ON TABLE public.classes FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.classes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.classes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.classes TO service_role;
REVOKE ALL ON TABLE public.coaching_case_events FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.coaching_case_events TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.coaching_case_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.coaching_case_events TO service_role;
REVOKE ALL ON TABLE public.coaching_case_handlers FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.coaching_case_handlers TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.coaching_case_handlers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.coaching_case_handlers TO service_role;
REVOKE ALL ON TABLE public.coaching_case_templates FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.coaching_case_templates TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.coaching_case_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.coaching_case_templates TO service_role;
REVOKE ALL ON TABLE public.coaching_cases FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.coaching_cases TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.coaching_cases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.coaching_cases TO service_role;
REVOKE ALL ON TABLE public.communication_categories FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.communication_categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.communication_categories TO service_role;
REVOKE ALL ON TABLE public.duty_schedules FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.duty_schedules TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.duty_schedules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.duty_schedules TO service_role;
REVOKE ALL ON TABLE public.evaluation_logs FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.evaluation_logs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.evaluation_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.evaluation_logs TO service_role;
REVOKE ALL ON TABLE public.forum_post_acknowledgements FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.forum_post_acknowledgements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.forum_post_acknowledgements TO service_role;
REVOKE ALL ON TABLE public.forum_post_audience FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.forum_post_audience TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.forum_post_audience TO service_role;
REVOKE ALL ON TABLE public.forum_post_comments FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.forum_post_comments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.forum_post_comments TO service_role;
REVOKE ALL ON TABLE public.forum_post_subjects FROM anon, authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.forum_post_subjects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.forum_post_subjects TO service_role;
REVOKE ALL ON TABLE public.forum_posts FROM anon, authenticated, service_role;
GRANT SELECT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.forum_posts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.forum_posts TO service_role;
REVOKE ALL ON TABLE public.generation_jobs FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.generation_jobs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.generation_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.generation_jobs TO service_role;
REVOKE ALL ON TABLE public.grade_recap FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.grade_recap TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.grade_recap TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.grade_recap TO service_role;
REVOKE ALL ON TABLE public.guru_wali_assignments FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.guru_wali_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.guru_wali_assignments TO service_role;
REVOKE ALL ON TABLE public.late_arrivals FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.late_arrivals TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.late_arrivals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.late_arrivals TO service_role;
REVOKE ALL ON TABLE public.ld_context_snapshots FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.ld_context_snapshots TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.ld_context_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.ld_context_snapshots TO service_role;
REVOKE ALL ON TABLE public.ld_document_nodes FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.ld_document_nodes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.ld_document_nodes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.ld_document_nodes TO service_role;
REVOKE ALL ON TABLE public.ld_document_tp_links FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.ld_document_tp_links TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.ld_document_tp_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.ld_document_tp_links TO service_role;
REVOKE ALL ON TABLE public.ld_document_versions FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.ld_document_versions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.ld_document_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.ld_document_versions TO service_role;
REVOKE ALL ON TABLE public.ld_documents FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.ld_documents TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.ld_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.ld_documents TO service_role;
REVOKE ALL ON TABLE public.ld_program_knowledge_national FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.ld_program_knowledge_national TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.ld_program_knowledge_national TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.ld_program_knowledge_national TO service_role;
REVOKE ALL ON TABLE public.ld_program_knowledge_school FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.ld_program_knowledge_school TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.ld_program_knowledge_school TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.ld_program_knowledge_school TO service_role;
REVOKE ALL ON TABLE public.ld_prompt_templates FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.ld_prompt_templates TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.ld_prompt_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.ld_prompt_templates TO service_role;
REVOKE ALL ON TABLE public.ld_teacher_knowledge FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.ld_teacher_knowledge TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.ld_teacher_knowledge TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.ld_teacher_knowledge TO service_role;
REVOKE ALL ON TABLE public.learning_objectives FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.learning_objectives TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.learning_objectives TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.learning_objectives TO service_role;
REVOKE ALL ON TABLE public.login_devices FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.login_devices TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.login_devices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.login_devices TO service_role;
REVOKE ALL ON TABLE public.notifications FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.notifications TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.notifications TO service_role;
REVOKE ALL ON TABLE public.observations FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.observations TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.observations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.observations TO service_role;
REVOKE ALL ON TABLE public.pending_auth_deletions FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.pending_auth_deletions TO service_role;
REVOKE ALL ON TABLE public.pkl_attendance FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.pkl_attendance TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.pkl_attendance TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.pkl_attendance TO service_role;
REVOKE ALL ON TABLE public.pkl_placements FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.pkl_placements TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.pkl_placements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.pkl_placements TO service_role;
REVOKE ALL ON TABLE public.platform_config FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.platform_config TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.platform_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.platform_config TO service_role;
REVOKE ALL ON TABLE public.programs FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.programs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.programs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.programs TO service_role;
REVOKE ALL ON TABLE public.prompt_templates FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.prompt_templates TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.prompt_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.prompt_templates TO service_role;
REVOKE ALL ON TABLE public.schedule_reapply_jobs FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.schedule_reapply_jobs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.schedule_reapply_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.schedule_reapply_jobs TO service_role;
REVOKE ALL ON TABLE public.schedule_reapply_targets FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.schedule_reapply_targets TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.schedule_reapply_targets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.schedule_reapply_targets TO service_role;
REVOKE ALL ON SEQUENCE public.schedule_reapply_targets_target_id_seq FROM anon, authenticated, service_role;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.schedule_reapply_targets_target_id_seq TO anon;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.schedule_reapply_targets_target_id_seq TO authenticated;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.schedule_reapply_targets_target_id_seq TO service_role;
REVOKE ALL ON TABLE public.schedule_templates FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.schedule_templates TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.schedule_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.schedule_templates TO service_role;
REVOKE ALL ON TABLE public.schedule_time_slots FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.schedule_time_slots TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.schedule_time_slots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.schedule_time_slots TO service_role;
REVOKE ALL ON TABLE public.school_config FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.school_config TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.school_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.school_config TO service_role;
REVOKE ALL ON TABLE public.schools FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.schools TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.schools TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.schools TO service_role;
REVOKE ALL ON TABLE public.student_exits FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.student_exits TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.student_exits TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.student_exits TO service_role;
REVOKE ALL ON TABLE public.student_grades FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.student_grades TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.student_grades TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.student_grades TO service_role;
REVOKE ALL ON TABLE public.student_groups FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.student_groups TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.student_groups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.student_groups TO service_role;
REVOKE ALL ON TABLE public.student_parents FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.student_parents TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.student_parents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.student_parents TO service_role;
REVOKE ALL ON TABLE public.student_updates FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.student_updates TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.student_updates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.student_updates TO service_role;
REVOKE ALL ON TABLE public.students FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.students TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.students TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.students TO service_role;
REVOKE ALL ON TABLE public.subject_code_aliases FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.subject_code_aliases TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.subject_code_aliases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.subject_code_aliases TO service_role;
REVOKE ALL ON TABLE public.subject_cp_mapping FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.subject_cp_mapping TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.subject_cp_mapping TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.subject_cp_mapping TO service_role;
REVOKE ALL ON TABLE public.subjects FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.subjects TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.subjects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.subjects TO service_role;
REVOKE ALL ON TABLE public.substitute_schedules FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.substitute_schedules TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.substitute_schedules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.substitute_schedules TO service_role;
REVOKE ALL ON TABLE public.sync_idempotency FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.sync_idempotency TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.sync_idempotency TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.sync_idempotency TO service_role;
REVOKE ALL ON TABLE public.teacher_attendance_log FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.teacher_attendance_log TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.teacher_attendance_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.teacher_attendance_log TO service_role;
REVOKE ALL ON TABLE public.teacher_document_approvals FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.teacher_document_approvals TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.teacher_document_approvals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.teacher_document_approvals TO service_role;
REVOKE ALL ON TABLE public.teacher_document_classes FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.teacher_document_classes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.teacher_document_classes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.teacher_document_classes TO service_role;
REVOKE ALL ON TABLE public.teacher_documents FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.teacher_documents TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.teacher_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.teacher_documents TO service_role;
REVOKE ALL ON TABLE public.teacher_journals FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.teacher_journals TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.teacher_journals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.teacher_journals TO service_role;
REVOKE ALL ON TABLE public.teacher_piket_assignments FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.teacher_piket_assignments TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.teacher_piket_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.teacher_piket_assignments TO service_role;
REVOKE ALL ON TABLE public.teacher_profiles FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.teacher_profiles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.teacher_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.teacher_profiles TO service_role;
REVOKE ALL ON TABLE public.teaching_assignments FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.teaching_assignments TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.teaching_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.teaching_assignments TO service_role;
REVOKE ALL ON TABLE public.teaching_contexts FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.teaching_contexts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.teaching_contexts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.teaching_contexts TO service_role;
REVOKE ALL ON TABLE public.teaching_cp FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.teaching_cp TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.teaching_cp TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.teaching_cp TO service_role;
REVOKE ALL ON TABLE public.teaching_cp_elements FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.teaching_cp_elements TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.teaching_cp_elements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.teaching_cp_elements TO service_role;
REVOKE ALL ON TABLE public.teaching_schedules FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.teaching_schedules TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.teaching_schedules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.teaching_schedules TO service_role;
REVOKE ALL ON TABLE public.tp_taught_status FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.tp_taught_status TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.tp_taught_status TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.tp_taught_status TO service_role;
REVOKE ALL ON TABLE public.tujuan_pembelajaran FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.tujuan_pembelajaran TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.tujuan_pembelajaran TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.tujuan_pembelajaran TO service_role;
REVOKE ALL ON TABLE public.users FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.users TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.users TO service_role;
REVOKE ALL ON TABLE public.v_academic_year_drift FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.v_academic_year_drift TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.v_academic_year_drift TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.v_academic_year_drift TO service_role;
REVOKE ALL ON TABLE public.v_attendance_daily_summary FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.v_attendance_daily_summary TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.v_attendance_daily_summary TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.v_attendance_daily_summary TO service_role;
REVOKE ALL ON TABLE public.v_core_subjects FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.v_core_subjects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.v_core_subjects TO service_role;
REVOKE ALL ON TABLE public.v_cp_for_generate FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.v_cp_for_generate TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.v_cp_for_generate TO service_role;
REVOKE ALL ON TABLE public.v_offline_sync_manifest_guru FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.v_offline_sync_manifest_guru TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.v_offline_sync_manifest_guru TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.v_offline_sync_manifest_guru TO service_role;
REVOKE ALL ON TABLE public.v_offline_sync_manifest_substitute FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.v_offline_sync_manifest_substitute TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.v_offline_sync_manifest_substitute TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.v_offline_sync_manifest_substitute TO service_role;
REVOKE ALL ON TABLE public.v_student_portal_positif FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.v_student_portal_positif TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.v_student_portal_positif TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.v_student_portal_positif TO service_role;
REVOKE ALL ON TABLE public.v_users_staff_directory FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.v_users_staff_directory TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.v_users_staff_directory TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.v_users_staff_directory TO service_role;
REVOKE ALL ON FUNCTION public.fn_admin_delete_coaching_case(p_case_id uuid, p_reason text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_admin_delete_coaching_case(p_case_id uuid, p_reason text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_admin_panel_dudi() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_admin_panel_dudi() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_admin_panel_staff(p_role_type text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_admin_panel_staff(p_role_type text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_apply_schedule_templates(p_academic_year text, p_semester semester, p_school_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_apply_schedule_templates(p_academic_year text, p_semester semester, p_school_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_attendance_fill_rate(p_date_start date, p_date_end date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_attendance_fill_rate(p_date_start date, p_date_end date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_attendance_period_lock() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_attendance_period_lock() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_attendance_recap_per_class(p_date_start date, p_date_end date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_attendance_recap_per_class(p_date_start date, p_date_end date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_audit_log_delete() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_audit_log_delete() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_auto_set_recorded_by() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_auto_set_recorded_by() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_auto_set_school_id() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_auto_set_school_id() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_batalkan_tahun_ajaran(p_config_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_batalkan_tahun_ajaran(p_config_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_buka_tahun_ajaran(p_config_id uuid, p_academic_year text, p_semester integer, p_start_date date, p_end_date date, p_old_academic_year text, p_promotion_mapping jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_buka_tahun_ajaran(p_config_id uuid, p_academic_year text, p_semester integer, p_start_date date, p_end_date date, p_old_academic_year text, p_promotion_mapping jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_bulk_import_students(p_rows jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bulk_import_students(p_rows jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_can_manage_pkl_student(p_student_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_can_manage_pkl_student(p_student_id uuid) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_can_read_forum_post(p_post_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_can_read_forum_post(p_post_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_can_see_coaching_case(p_case_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_can_see_coaching_case(p_case_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_can_see_student(p_student_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_can_see_student(p_student_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_case_events_immutable() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_case_events_immutable() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_case_events_no_closed() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_case_events_no_closed() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_case_initiated_by_immutable() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_case_initiated_by_immutable() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_check_assessment_criteria_overlap() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_check_assessment_criteria_overlap() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_check_element_duplicate(p_element_id uuid, p_school_id uuid, p_lo_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_check_element_duplicate(p_element_id uuid, p_school_id uuid, p_lo_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_check_identifiers_exist(p_identifiers text[], p_school_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_check_identifiers_exist(p_identifiers text[], p_school_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_check_kktp_no_overlap() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_check_kktp_no_overlap() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_check_niks_exist(p_niks text[], p_school_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_check_niks_exist(p_niks text[], p_school_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_class_attendance_summary(p_class_id uuid, p_academic_year text, p_date_start date, p_date_end date, p_teacher_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_class_attendance_summary(p_class_id uuid, p_academic_year text, p_date_start date, p_date_end date, p_teacher_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_close_semester(p_period_id uuid, p_config_id uuid, p_semester text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_close_semester(p_period_id uuid, p_config_id uuid, p_semester text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_coaching_case_audit_delete() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_coaching_case_audit_delete() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_coaching_case_events_immutable() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_coaching_case_events_immutable() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_coaching_case_events_no_closed() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_coaching_case_events_no_closed() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_coaching_case_guard() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_coaching_case_guard() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_coaching_case_immutable_creator() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_coaching_case_immutable_creator() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_coaching_case_log_create() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_coaching_case_log_create() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_coaching_case_sync_handler() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_coaching_case_sync_handler() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_confirm_password_changed() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_confirm_password_changed() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_count_unread_notifications() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_count_unread_notifications() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_create_forum_post(p_class_id uuid, p_academic_year text, p_content text, p_category_code text, p_subject_student_ids uuid[], p_audience_type text, p_specific_user_ids uuid[], p_audience_type_2 text, p_specific_user_ids_2 uuid[], p_scope_type text, p_title text, p_idempotency_key uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_create_forum_post(p_class_id uuid, p_academic_year text, p_content text, p_category_code text, p_subject_student_ids uuid[], p_audience_type text, p_specific_user_ids uuid[], p_audience_type_2 text, p_specific_user_ids_2 uuid[], p_scope_type text, p_title text, p_idempotency_key uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_create_placement(p_student_id uuid, p_dudi_user_id uuid, p_start_date date, p_end_date date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_create_placement(p_student_id uuid, p_dudi_user_id uuid, p_start_date date, p_end_date date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_current_academic_year(p_school_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_current_academic_year(p_school_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_current_school_id() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_current_school_id() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_current_student_id() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_current_student_id() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_current_user_id() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_current_user_id() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_current_user_role() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_current_user_role() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_deactivate_stale_staff() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_deactivate_stale_staff() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_delete_forum_post(p_post_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_delete_forum_post(p_post_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_delete_school_coaching_case_events(p_school_id uuid, p_after_event_id uuid, p_limit integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_delete_school_coaching_case_events(p_school_id uuid, p_after_event_id uuid, p_limit integer) TO service_role;
REVOKE ALL ON FUNCTION public.fn_delete_teacher_document(p_doc_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_delete_teacher_document(p_doc_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_dudi_can_record_attendance(p_placement_id uuid, p_student_id uuid, p_date date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_dudi_can_record_attendance(p_placement_id uuid, p_student_id uuid, p_date date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_dudi_owns_placement(p_placement_id uuid, p_student_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_dudi_owns_placement(p_placement_id uuid, p_student_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_dudi_placements() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_dudi_placements() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_dudi_supervises_student(p_student_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_dudi_supervises_student(p_student_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_evaluate_teacher_indicators(p_session_date date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_evaluate_teacher_indicators(p_session_date date) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_finalize_reapply_job(p_job_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_finalize_reapply_job(p_job_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_finish_placement(p_student_id uuid, p_placement_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_finish_placement(p_student_id uuid, p_placement_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_forum_attachment_moderator() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_forum_attachment_moderator() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_forum_attachment_readable(p_path text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_forum_attachment_readable(p_path text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_get_active_reapply_job(p_academic_year text, p_semester semester) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_active_reapply_job(p_academic_year text, p_semester semester) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_get_all_grades_summary(p_student_id uuid, p_academic_year character varying, p_semester integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_all_grades_summary(p_student_id uuid, p_academic_year character varying, p_semester integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_get_cp_for_subject(p_subject_id uuid, p_program_code character varying, p_grade_level smallint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_cp_for_subject(p_subject_id uuid, p_program_code character varying, p_grade_level smallint) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_get_escalation_candidates(p_case_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_escalation_candidates(p_case_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_get_forum_bk_staff() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_forum_bk_staff() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_get_forum_member_details(p_class_id uuid, p_academic_year text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_forum_member_details(p_class_id uuid, p_academic_year text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_get_forum_members(p_class_id uuid, p_academic_year text, p_visibility text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_forum_members(p_class_id uuid, p_academic_year text, p_visibility text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_get_forum_recipient_candidates(p_target_group text, p_program_id uuid, p_class_id uuid, p_day_of_week smallint, p_academic_year text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_forum_recipient_candidates(p_target_group text, p_program_id uuid, p_class_id uuid, p_day_of_week smallint, p_academic_year text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_get_stale_staff() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_stale_staff() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_get_user_forum_scope(p_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_user_forum_scope(p_user_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_get_wali_kelas_user_id(p_class_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_wali_kelas_user_id(p_class_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_guard_forum_assignment_tenant() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_guard_forum_assignment_tenant() TO service_role;
REVOKE ALL ON FUNCTION public.fn_guard_teacher_doc_status_transition() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_guard_teacher_doc_status_transition() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_guard_tp_assessment_update() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_guard_tp_assessment_update() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_guard_users_protected_columns() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_guard_users_protected_columns() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_guru_supervises_pkl_student(p_student_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_guru_supervises_pkl_student(p_student_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_guru_teaches_student(p_student_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_guru_teaches_student(p_student_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_has_teaching_schedule(p_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_has_teaching_schedule(p_user_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_is_bk() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_is_bk() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_is_kepsek() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_is_kepsek() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_is_observation_subject_or_parent(p_observation_id uuid, p_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_is_observation_subject_or_parent(p_observation_id uuid, p_user_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_is_on_duty_today() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_is_on_duty_today() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_is_parent_of_student(p_student_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_is_parent_of_student(p_student_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_is_period_closed(p_date date, p_school_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_is_period_closed(p_date date, p_school_id uuid) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_is_schoolwide_observer() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_is_schoolwide_observer() TO service_role;
REVOKE ALL ON FUNCTION public.fn_is_tu() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_is_tu() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_is_waka_humas() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_is_waka_humas() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_is_waka_kesiswaan() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_is_waka_kesiswaan() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_is_waka_kurikulum() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_is_waka_kurikulum() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_kaprodi_of_student(p_student_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_kaprodi_of_student(p_student_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_kaprodi_program_id() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_kaprodi_program_id() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_kepsek_monitoring(p_period text, p_academic_year text, p_date_start date, p_date_end date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_kepsek_monitoring(p_period text, p_academic_year text, p_date_start date, p_date_end date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ld_doc_in_caller_school(p_document_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ld_doc_in_caller_school(p_document_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ld_doc_owned_by_caller(p_document_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ld_doc_owned_by_caller(p_document_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_maintenance_status() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_maintenance_status() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_matches_case_handler(p_handler_role role_type, p_student_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_matches_case_handler(p_handler_role role_type, p_student_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_notify_on_case_created() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_notify_on_case_created() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_notify_on_case_event() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_notify_on_case_event() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_notify_on_exit() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_notify_on_exit() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_notify_on_forum_comment() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_notify_on_forum_comment() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_notify_on_late_arrival() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_notify_on_late_arrival() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_notify_on_observation() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_notify_on_observation() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_observation_period_lock() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_observation_period_lock() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_observation_visibility_default() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_observation_visibility_default() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_observation_visibility_immutable() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_observation_visibility_immutable() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_owns_assessment(p_assessment_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_owns_assessment(p_assessment_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_owns_learning_objective(p_lo_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_owns_learning_objective(p_lo_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_parent_has_child_in_class(p_class_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_parent_has_child_in_class(p_class_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_parent_msg_lock_check() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_parent_msg_lock_check() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_pending_attendance_sessions(p_date date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_pending_attendance_sessions(p_date date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_pending_sessions_by_teacher(p_date_start date, p_date_end date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_pending_sessions_by_teacher(p_date_start date, p_date_end date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_pending_sessions_detail(p_teacher_id uuid, p_date_start date, p_date_end date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_pending_sessions_detail(p_teacher_id uuid, p_date_start date, p_date_end date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_pkl_attendance_period_lock() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_pkl_attendance_period_lock() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_pkl_attendance_recap(p_student_ids uuid[], p_date_start date, p_date_end date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_pkl_attendance_recap(p_student_ids uuid[], p_date_start date, p_date_end date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_pkl_status_consistency() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_pkl_status_consistency() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_platform_storage() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_platform_storage() TO service_role;
REVOKE ALL ON FUNCTION public.fn_portal_assessment_visible(p_assessment_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_portal_assessment_visible(p_assessment_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_portal_attendance(p_student_id uuid, p_date_start date, p_date_end date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_portal_attendance(p_student_id uuid, p_date_start date, p_date_end date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_portal_can_read_student(p_student_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_portal_can_read_student(p_student_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_portal_recap_visible(p_learning_objective_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_portal_recap_visible(p_learning_objective_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_portal_user_labels(p_user_ids uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_portal_user_labels(p_user_ids uuid[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_prepare_reapply_job(p_academic_year text, p_semester semester) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_prepare_reapply_job(p_academic_year text, p_semester semester) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_purge_expired_student(p_student_id uuid, p_school_id uuid, p_last_table text, p_last_id uuid, p_batch_size integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_purge_expired_student(p_student_id uuid, p_school_id uuid, p_last_table text, p_last_id uuid, p_batch_size integer) TO service_role;
REVOKE ALL ON FUNCTION public.fn_reapply_batch(p_job_id uuid, p_batch_size integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_reapply_batch(p_job_id uuid, p_batch_size integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_reapply_schedule_templates(p_academic_year text, p_semester semester, p_school_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_reapply_schedule_templates(p_academic_year text, p_semester semester, p_school_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_register_login_device(p_device_hash text, p_user_agent text, p_label text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_register_login_device(p_device_hash text, p_user_agent text, p_label text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_remove_school_admin(p_actor_user_id uuid, p_target_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_remove_school_admin(p_actor_user_id uuid, p_target_user_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_resolve_login_email(p_identifier text, p_school_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_resolve_login_email(p_identifier text, p_school_id uuid) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_resolve_teacher_names(p_auth_ids uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_resolve_teacher_names(p_auth_ids uuid[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_save_schedule_day(p_academic_year text, p_semester semester, p_day_of_week day_of_week, p_slots jsonb, p_templates jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_save_schedule_day(p_academic_year text, p_semester semester, p_day_of_week day_of_week, p_slots jsonb, p_templates jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_save_schedule_templates(p_academic_year text, p_semester semester, p_day_of_week day_of_week, p_templates jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_save_schedule_templates(p_academic_year text, p_semester semester, p_day_of_week day_of_week, p_templates jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_save_time_slots(p_academic_year text, p_semester semester, p_day_of_week day_of_week, p_slots jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_save_time_slots(p_academic_year text, p_semester semester, p_day_of_week day_of_week, p_slots jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_school_branding(p_slug text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_school_branding(p_slug text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_school_staff_health() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_school_staff_health() TO service_role;
REVOKE ALL ON FUNCTION public.fn_school_student_health() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_school_student_health() TO service_role;
REVOKE ALL ON FUNCTION public.fn_set_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_set_updated_at() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_stakeholder_summary() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_stakeholder_summary() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_student_enrolled_in_class(p_class_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_student_enrolled_in_class(p_class_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_student_in_current_school(p_student_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_student_in_current_school(p_student_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_student_is_on_pkl(p_student_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_student_is_on_pkl(p_student_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_student_nis_immutable() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_student_nis_immutable() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_sync_attendance_batch(p_schedule_id uuid, p_submitted_by uuid, p_records jsonb, p_meeting_status text, p_idempotency_key text, p_is_substitute boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_sync_attendance_batch(p_schedule_id uuid, p_submitted_by uuid, p_records jsonb, p_meeting_status text, p_idempotency_key text, p_is_substitute boolean) TO service_role;
REVOKE ALL ON FUNCTION public.fn_sync_coaching_case(p_idempotency_key text, p_case_id uuid, p_student_id uuid, p_created_by_user_id uuid, p_track text, p_title text, p_description text, p_initiated_by_role text, p_audience text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_sync_coaching_case(p_idempotency_key text, p_case_id uuid, p_student_id uuid, p_created_by_user_id uuid, p_track text, p_title text, p_description text, p_initiated_by_role text, p_audience text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_sync_journal(p_idempotency_key text, p_journal_id uuid, p_owner_user_id uuid, p_entry_date date, p_content text, p_schedule_id uuid, p_class_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_sync_journal(p_idempotency_key text, p_journal_id uuid, p_owner_user_id uuid, p_entry_date date, p_content text, p_schedule_id uuid, p_class_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_sync_observation(p_idempotency_key text, p_observation_id uuid, p_author_user_id uuid, p_student_id uuid, p_sentiment text, p_dimension text, p_visibility text, p_content text, p_observed_at timestamp with time zone, p_schedule_id uuid, p_class_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_sync_observation(p_idempotency_key text, p_observation_id uuid, p_author_user_id uuid, p_student_id uuid, p_sentiment text, p_dimension text, p_visibility text, p_content text, p_observed_at timestamp with time zone, p_schedule_id uuid, p_class_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_teacher_attendance_signal() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_teacher_attendance_signal() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_teaches_class(p_class_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_teaches_class(p_class_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_teaches_student(p_student_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_teaches_student(p_student_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_toggle_forum_post_withdrawn(p_post_id uuid, p_withdrawn boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_toggle_forum_post_withdrawn(p_post_id uuid, p_withdrawn boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_toggle_tp_taught(p_class_id uuid, p_tp_id text, p_is_taught boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_toggle_tp_taught(p_class_id uuid, p_tp_id text, p_is_taught boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_touch_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_touch_updated_at() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_unvoid_session_attendance() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_unvoid_session_attendance() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_update_program(p_program_id uuid, p_code text, p_name text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_update_program(p_program_id uuid, p_code text, p_name text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_update_school_branding(p_name text, p_npsn text, p_address text, p_phone text, p_logo_url text, p_primary_color text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_update_school_branding(p_name text, p_npsn text, p_address text, p_phone text, p_logo_url text, p_primary_color text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_update_school_branding(p_name text, p_npsn text, p_address text, p_phone text, p_logo_url text, p_primary_color text, p_secondary_color text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_update_school_branding(p_name text, p_npsn text, p_address text, p_phone text, p_logo_url text, p_primary_color text, p_secondary_color text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_validate_escalation() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_validate_escalation() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_validate_parent_forum_audience() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_validate_parent_forum_audience() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_validate_student_parent_tenant() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_validate_student_parent_tenant() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_void_session_attendance() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_void_session_attendance() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_waka_approve_doc(p_doc_id uuid, p_action character varying, p_catatan text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_waka_approve_doc(p_doc_id uuid, p_action character varying, p_catatan text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_waka_kur_stats(p_date_start date, p_date_end date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_waka_kur_stats(p_date_start date, p_date_end date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_wali_attendance_sessions(p_class_id uuid, p_academic_year text, p_student_id uuid, p_date_start date, p_date_end date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_wali_attendance_sessions(p_class_id uuid, p_academic_year text, p_student_id uuid, p_date_start date, p_date_end date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_wali_kelas_class_id() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_wali_kelas_class_id() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_wali_of_student(p_student_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_wali_of_student(p_student_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_wizard_reset_schedules(p_school_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_wizard_reset_schedules(p_school_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_wizard_reset_students(p_school_id uuid, p_student_ids uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_wizard_reset_students(p_school_id uuid, p_student_ids uuid[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.trg_close_enrollment_on_graduation() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.trg_close_enrollment_on_graduation() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.trg_pkl_attendance_student_match() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.trg_pkl_attendance_student_match() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.trg_substitute_not_original() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.trg_substitute_not_original() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.trg_sync_student_name_to_user() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.trg_sync_student_name_to_user() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.trg_sync_user_name_to_student() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.trg_sync_user_name_to_student() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_ld_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_ld_updated_at() TO authenticated, service_role;

-- ============================================================
-- Hak akses tingkat kolom (dari database sumber)
-- ============================================================
GRANT UPDATE (is_read) ON public.notifications TO authenticated;

-- ============================================================
-- Storage: bucket dan policy (policy storage.objects ada di bagian Policy)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('forum-attachments', 'forum-attachments', false, 10485760, ARRAY['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']::text[]) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Cron (DIKOMENTARI: sesuaikan URL proyek baru, lalu aktifkan manual)
-- ============================================================
-- jobname: evaluate-teacher-indicators-daily  schedule: 0 17 * * *
-- SELECT net.http_post(
--     url := 'https://<PROYEK-BARU>.supabase.co/functions/v1/evaluate-teacher-indicators',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'X-Superadmin-Key', '8269838d9831005ff9723d419a1bdb4003e50bf6b4b75383b6ba9f254e2a93de'
--     ),
--     body := '{}'::jsonb
--   );
