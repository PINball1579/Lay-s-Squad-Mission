ALTER TABLE mission_attempts
    ADD CONSTRAINT mission_attempts_id_assignment_key UNIQUE (id, assignment_id);

ALTER TABLE mission_completions
    ADD CONSTRAINT mission_completions_attempt_assignment_fk
    FOREIGN KEY (attempt_id, assignment_id)
    REFERENCES mission_attempts(id, assignment_id)
    ON DELETE RESTRICT;
