-- Membuang fitur "perangkat ajar" (ATP/Prota/dokumen guru) yang sudah dihapus dari antarmuka.
-- 16 tabel berisi 0 baris di produksi (dibaca 16 Okt 2026). Tanpa CASCADE: bila ada ketergantungan
-- tak terduga, migrasi gagal seluruhnya dan tidak ada yang terhapus.
-- delete-school versi baru WAJIB sudah di-deploy sebelum migrasi ini dipasang.
SET search_path = public, extensions;

DROP TABLE public.evaluation_logs,
           public.generation_jobs,
           public.teacher_document_classes,
           public.teacher_document_approvals,
           public.teacher_documents,
           public.teacher_profiles,
           public.teaching_contexts,
           public.ld_context_snapshots,
           public.ld_document_nodes,
           public.ld_document_tp_links,
           public.ld_document_versions,
           public.ld_documents,
           public.ld_program_knowledge_national,
           public.ld_program_knowledge_school,
           public.ld_prompt_templates,
           public.ld_teacher_knowledge;

DROP FUNCTION public.fn_delete_teacher_document(uuid);
DROP FUNCTION public.fn_waka_approve_doc(uuid, character varying, text);
DROP FUNCTION public.fn_ld_doc_in_caller_school(uuid);
DROP FUNCTION public.fn_ld_doc_owned_by_caller(uuid);
DROP FUNCTION public.fn_guard_teacher_doc_status_transition();
DROP FUNCTION public.update_ld_updated_at();

DROP TYPE public.ld_document_status;
DROP TYPE public.ld_document_type;
DROP TYPE public.ld_generation_source;
DROP TYPE public.ld_node_type;
