-- =====================================================================
-- Prototype X (FloraScan) - Plant Registry, QR Codes & IoT Monitoring
-- MySQL schema v2 - updated to match the COS30049 project proposal
--
-- Target : MySQL 8.0.16 or later (CHECK constraints are enforced from 8.0.16)
-- Engine : InnoDB, charset utf8mb4
-- Usage  : mysql -u root -p < plant_registry_schema.sql
--          Drops and recreates the database - never run it against real data.
-- Times  : keep every DATETIME in UTC. Have the API run
--          SET time_zone = '+00:00' on each connection and convert to
--          local time (UTC+8) in the app.
--
-- 23 tables in six groups, plus one view:
--   1. Identity & access  roles, permissions, role_permissions, users,
--                         password_resets, refresh_tokens, user_activity_logs
--   2. Plant data         conservation_statuses, species, plants, plant_photos
--   3. Review workflow    plant_submissions, plant_revisions, plant_reports
--   4. QR codes           qr_codes, qr_scans
--   5. System             notifications, audit_logs, settings, import_jobs
--   6. IoT monitoring     sensor_devices, sensor_readings, sensor_alerts (new)
--   View                  v_public_plants
--
-- Changes from v1 (20 tables), following the proposal:
--   - Three staff roles: admin, botanist, ranger. Visitors never log in, so
--     the 'user' role and the demo visitor are gone. Superuser is future
--     work: one more role holding every permission (see section 8).
--   - Permissions rebuilt from the proposal's who-can-do-what. The API
--     checks permission codes such as 'plant.edit', never role names.
--   - Plant lifecycle is pending / approved / rejected / archived ('draft'
--     is deferred). New plants default to 'pending' so nothing is published
--     by accident; the API saves a botanist's own entry as 'approved'.
--   - "Species not listed": plants.species_id may be NULL while a ranger's
--     entry waits for review, with the typed name in proposed_species_name.
--     A plant cannot be approved without a real species.
--   - Review: approve, or reject with a note (the note is required).
--     'changes_requested' is deferred.
--   - QR codes are created automatically on publish; the database now
--     enforces at most one active code per plant.
--   - Search covers the proposal's five fields: the species full-text index
--     now includes family and genus, and plants gets a location index.
--   - users.must_change_password supports password resets by an admin.
--   - plant_photos.thumbnail_path holds the resized copy the API makes.
--   - New IoT group (section 6). At most one open alert per sensor and
--     reading type is enforced by a unique key.
--   - notifications.related_id and audit_logs.entity_id widened to BIGINT.
--   - v_public_plants adds the botanical and specimen fields.
--   - New setting: sensor_offline_minutes.
-- =====================================================================

DROP DATABASE IF EXISTS plant_registry;
CREATE DATABASE plant_registry
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE plant_registry;


-- =====================================================================
-- 1. IDENTITY & ACCESS
-- =====================================================================

-- Staff roles only: admin, botanist, ranger. Public visitors have no account.
CREATE TABLE roles (
  id           TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name         VARCHAR(30)      NOT NULL,   -- 'admin', 'botanist', 'ranger'
  label        VARCHAR(60)      NOT NULL,
  description  VARCHAR(255)     NULL,
  created_at   DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_name (name)
) ENGINE=InnoDB;


-- The API checks these codes on every request - never role names - so a
-- superuser can be added later as data, with no code changes.
CREATE TABLE permissions (
  id           SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code         VARCHAR(60)       NOT NULL,   -- e.g. 'plant.approve'
  description  VARCHAR(255)      NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_permissions_code (code)
) ENGINE=InnoDB;


CREATE TABLE role_permissions (
  role_id        TINYINT UNSIGNED  NOT NULL,
  permission_id  SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  KEY idx_rp_permission (permission_id),
  CONSTRAINT fk_rp_role
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_rp_permission
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB;


-- Staff accounts. There is no public sign-up: an admin creates every
-- account, resets passwords and activates / deactivates users.
CREATE TABLE users (
  id                    INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  role_id               TINYINT UNSIGNED NOT NULL,
  full_name             VARCHAR(120)     NOT NULL,
  email                 VARCHAR(190)     NOT NULL,
  phone                 VARCHAR(30)      NULL,
  password_hash         VARCHAR(255)     NOT NULL,  -- bcrypt/argon2 output, never plaintext
  must_change_password  TINYINT(1)       NOT NULL DEFAULT 0,  -- 1 after an admin reset
  is_active             TINYINT(1)       NOT NULL DEFAULT 1,
  email_verified_at     DATETIME         NULL,
  last_login_at         DATETIME         NULL,
  created_by            INT UNSIGNED     NULL,      -- admin who created this account
  created_at            DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP
                                         ON UPDATE CURRENT_TIMESTAMP,
  deleted_at            DATETIME         NULL,      -- soft delete
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role (role_id),
  KEY idx_users_active (is_active, deleted_at),
  CONSTRAINT fk_users_role
    FOREIGN KEY (role_id) REFERENCES roles(id),
  CONSTRAINT fk_users_creator
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;


-- One-time links for self-service password reset (a later release).
-- In this release an admin resets the password instead: the API saves a
-- temporary hash and sets users.must_change_password = 1.
CREATE TABLE password_resets (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED NOT NULL,
  token_hash  CHAR(64)     NOT NULL,   -- SHA-256 of the token, not the token
  expires_at  DATETIME     NOT NULL,
  used_at     DATETIME     NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pr_token (token_hash),
  KEY idx_pr_user (user_id),
  CONSTRAINT fk_pr_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;


-- Login sessions. Revoke a user's tokens on logout or when an admin
-- deactivates the account.
CREATE TABLE refresh_tokens (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      INT UNSIGNED    NOT NULL,
  token_hash   CHAR(64)        NOT NULL,
  device_info  VARCHAR(255)    NULL,   -- lets a ranger stay logged in on the phone
  expires_at   DATETIME        NOT NULL,
  revoked_at   DATETIME        NULL,
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rt_token (token_hash),
  KEY idx_rt_user (user_id, revoked_at),
  CONSTRAINT fk_rt_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;


-- Activity log on the Admin dashboard: logins, logouts, failed logins.
-- Who added, edited or archived which record is in audit_logs.
CREATE TABLE user_activity_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED    NULL,
  action      VARCHAR(60)     NOT NULL,   -- 'login', 'logout', 'login_failed', 'password_changed'
  detail      VARCHAR(255)    NULL,
  ip_address  VARCHAR(45)     NULL,       -- 45 chars fits IPv6
  user_agent  VARCHAR(255)    NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ual_user_time (user_id, created_at),
  CONSTRAINT fk_ual_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;


-- =====================================================================
-- 2. PLANT DATA
-- =====================================================================

CREATE TABLE conservation_statuses (
  id          TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(5)       NOT NULL,   -- IUCN codes
  label       VARCHAR(60)      NOT NULL,
  sort_order  TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cs_code (code)
) ENGINE=InnoDB;


-- Botanical information shared by every specimen of the same species.
-- Only botanists add or edit species (permission 'species.manage').
CREATE TABLE species (
  id                      INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  scientific_name         VARCHAR(180)     NOT NULL,
  common_name             VARCHAR(180)     NULL,
  local_name              VARCHAR(180)     NULL,   -- e.g. Malay name
  family                  VARCHAR(100)     NULL,
  genus                   VARCHAR(100)     NULL,
  species_epithet         VARCHAR(100)     NULL,
  description             TEXT             NULL,
  characteristics         TEXT             NULL,
  growth_form             VARCHAR(50)      NULL,   -- 'tree', 'shrub', 'climber', 'epiphyte' ...
  leaf_description        TEXT             NULL,
  flower_description      TEXT             NULL,
  fruit_description       TEXT             NULL,
  habitat                 TEXT             NULL,
  distribution            TEXT             NULL,
  conservation_status_id  TINYINT UNSIGNED NULL,
  created_by              INT UNSIGNED     NULL,
  created_at              DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP
                                           ON UPDATE CURRENT_TIMESTAMP,
  deleted_at              DATETIME         NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_species_scientific (scientific_name),
  KEY idx_species_family (family),
  KEY idx_species_genus (genus),
  KEY idx_species_common (common_name),
  FULLTEXT KEY ft_species_search
    (scientific_name, common_name, local_name, family, genus),
  CONSTRAINT fk_species_status
    FOREIGN KEY (conservation_status_id) REFERENCES conservation_statuses(id),
  CONSTRAINT fk_species_creator
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;


-- One row = one physical plant in the field, carrying one QR tag.
-- Lifecycle:
--   botanist's entry           -> 'approved' straight away
--   ranger's entry             -> 'pending' until a botanist approves it or
--                                 rejects it with a note ('approved' at once
--                                 while settings.require_approval = 'false',
--                                 unless the species isn't listed yet)
--   withdrawn from public view -> 'archived'
-- Only 'approved' plants appear in v_public_plants.
CREATE TABLE plants (
  id                     INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  plant_code             VARCHAR(24)   NOT NULL,   -- public Plant ID, e.g. 'PLT-2026-0001'
  species_id             INT UNSIGNED  NULL,       -- NULL only while a "species not listed" entry awaits review
  proposed_species_name  VARCHAR(180)  NULL,       -- "species not listed": the name the ranger typed
  status                 ENUM('pending','approved','rejected','archived')
                                       NOT NULL DEFAULT 'pending',
  -- location, captured by the phone's GPS
  latitude               DECIMAL(10,7) NULL,       -- ~1cm precision, plenty for GPS
  longitude              DECIMAL(10,7) NULL,
  altitude_m             DECIMAL(7,2)  NULL,
  gps_accuracy_m         DECIMAL(6,2)  NULL,
  site_name              VARCHAR(150)  NULL,       -- 'Trail B, marker 12' - searchable
  location_notes         TEXT          NULL,
  -- specimen details
  height_m               DECIMAL(6,2)  NULL,
  trunk_diameter_cm      DECIMAL(7,2)  NULL,
  health_status          ENUM('healthy','fair','poor','dead') NULL,
  life_stage             ENUM('seedling','sapling','mature') NULL,
  morphology_notes       TEXT          NULL,
  notes                  TEXT          NULL,       -- 'Additional notes' (staff only)
  view_count             INT UNSIGNED  NOT NULL DEFAULT 0,
  registered_by          INT UNSIGNED  NULL,       -- staff member who registered it
  registered_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_by            INT UNSIGNED  NULL,       -- botanist who approved it (or entered it)
  verified_at            DATETIME      NULL,
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                                       ON UPDATE CURRENT_TIMESTAMP,
  deleted_at             DATETIME      NULL,       -- soft delete
  PRIMARY KEY (id),
  UNIQUE KEY uq_plants_code (plant_code),
  KEY idx_plants_species (species_id),
  KEY idx_plants_status (status, deleted_at),
  KEY idx_plants_registrar (registered_by, status),
  KEY idx_plants_geo (latitude, longitude),
  KEY idx_plants_site (site_name),
  FULLTEXT KEY ft_plants_location (site_name, location_notes),
  CONSTRAINT chk_plants_species_given
    CHECK (species_id IS NOT NULL OR proposed_species_name IS NOT NULL),
  CONSTRAINT chk_plants_approved_species
    CHECK (status <> 'approved' OR species_id IS NOT NULL),
  CONSTRAINT chk_plants_latitude
    CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT chk_plants_longitude
    CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT fk_plants_species
    FOREIGN KEY (species_id) REFERENCES species(id),
  CONSTRAINT fk_plants_registrar
    FOREIGN KEY (registered_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_plants_verifier
    FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;


-- Photos are files on the API server; MySQL stores only their paths.
CREATE TABLE plant_photos (
  id              INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  plant_id        INT UNSIGNED      NOT NULL,
  file_path       VARCHAR(255)      NOT NULL,  -- path on the server, NOT the image
  thumbnail_path  VARCHAR(255)      NULL,      -- resized copy for lists and search results
  file_name       VARCHAR(180)      NULL,      -- original upload name
  mime_type       VARCHAR(60)       NOT NULL,
  size_bytes      INT UNSIGNED      NOT NULL,
  width_px        SMALLINT UNSIGNED NULL,
  height_px       SMALLINT UNSIGNED NULL,
  caption         VARCHAR(255)      NULL,
  is_primary      TINYINT(1)        NOT NULL DEFAULT 0,
  uploaded_by     INT UNSIGNED      NULL,
  created_at      DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at      DATETIME          NULL,
  PRIMARY KEY (id),
  KEY idx_photos_plant (plant_id, is_primary),
  CONSTRAINT fk_photos_plant
    FOREIGN KEY (plant_id) REFERENCES plants(id) ON DELETE CASCADE,
  CONSTRAINT fk_photos_uploader
    FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;


-- =====================================================================
-- 3. REVIEW WORKFLOW
-- =====================================================================

-- The botanist review queue. Each ranger entry that needs review gets a row
-- here; the botanist approves it, or rejects it with a note, and the ranger
-- follows the result under "my submissions".
-- 'edit' + proposed_changes (JSON) are kept for ranger-proposed corrections.
-- They are unused in this release, where only botanists edit, directly.
CREATE TABLE plant_submissions (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  plant_id          INT UNSIGNED NOT NULL,
  submission_type   ENUM('new','edit') NOT NULL DEFAULT 'new',
  status            ENUM('pending','approved','rejected')
                                 NOT NULL DEFAULT 'pending',
  proposed_changes  JSON         NULL,
  submitted_by      INT UNSIGNED NOT NULL,
  submitted_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by       INT UNSIGNED NULL,
  reviewed_at       DATETIME     NULL,
  review_comment    TEXT         NULL,   -- required when rejecting
  PRIMARY KEY (id),
  KEY idx_sub_status (status, submitted_at),
  KEY idx_sub_plant (plant_id),
  KEY idx_sub_submitter (submitted_by, status),
  CONSTRAINT chk_sub_reject_note
    CHECK (status <> 'rejected'
           OR (review_comment IS NOT NULL AND CHAR_LENGTH(TRIM(review_comment)) > 0)),
  CONSTRAINT fk_sub_plant
    FOREIGN KEY (plant_id) REFERENCES plants(id) ON DELETE CASCADE,
  CONSTRAINT fk_sub_submitter
    FOREIGN KEY (submitted_by) REFERENCES users(id),
  CONSTRAINT fk_sub_reviewer
    FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;


-- Field-level change history of a plant: who / field / old value /
-- new value / when. Shown to botanists on the plant's history tab.
CREATE TABLE plant_revisions (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  plant_id       INT UNSIGNED    NOT NULL,
  changed_by     INT UNSIGNED    NULL,
  source_table   VARCHAR(40)     NOT NULL DEFAULT 'plants',  -- 'plants' or 'species'
  field_name     VARCHAR(60)     NOT NULL,
  old_value      TEXT            NULL,
  new_value      TEXT            NULL,
  change_reason  VARCHAR(255)    NULL,
  created_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_rev_plant (plant_id, created_at),
  CONSTRAINT fk_rev_plant
    FOREIGN KEY (plant_id) REFERENCES plants(id) ON DELETE CASCADE,
  CONSTRAINT fk_rev_user
    FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;


-- Public "report incorrect information". Not in this release's delivered
-- list; the table stays so the feature can be switched on later without a
-- schema change. reported_by is NULL for anonymous visitors.
CREATE TABLE plant_reports (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  plant_id         INT UNSIGNED NOT NULL,
  reported_by      INT UNSIGNED NULL,
  reporter_name    VARCHAR(120) NULL,
  reporter_email   VARCHAR(190) NULL,
  issue_type       ENUM('wrong_name','wrong_location','bad_photo','outdated','other')
                                NOT NULL DEFAULT 'other',
  description      TEXT         NOT NULL,
  status           ENUM('open','reviewing','resolved','dismissed')
                                NOT NULL DEFAULT 'open',
  handled_by       INT UNSIGNED NULL,
  handled_at       DATETIME     NULL,
  resolution_note  TEXT         NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_rep_status (status, created_at),
  KEY idx_rep_plant (plant_id),
  CONSTRAINT fk_rep_plant
    FOREIGN KEY (plant_id) REFERENCES plants(id) ON DELETE CASCADE,
  CONSTRAINT fk_rep_reporter
    FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_rep_handler
    FOREIGN KEY (handled_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;


-- =====================================================================
-- 4. QR CODES
-- =====================================================================

-- Created automatically the first time a plant is published (approved).
-- qr_token is what goes in the QR URL, e.g. /p/3f2a9c1e-... It is opaque:
-- never put plants.id in the QR, or anyone can enumerate the register.
-- The token does not change when the plant record is edited, so printed
-- tags stay valid. A damaged or leaked tag can be replaced: the old row
-- becomes 'replaced' and a new token is issued. uq_qr_one_active allows at
-- most one 'active' code per plant.
CREATE TABLE qr_codes (
  id                   INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  plant_id             INT UNSIGNED      NOT NULL,
  qr_token             CHAR(36)          NOT NULL,   -- UUID v4
  image_path           VARCHAR(255)      NULL,       -- generated PNG/SVG on the server
  target_url           VARCHAR(255)      NULL,       -- settings.qr_base_url + qr_token
  version              SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  status               ENUM('active','inactive','replaced')
                                         NOT NULL DEFAULT 'active',
  active_flag          TINYINT UNSIGNED
                       AS (IF(status = 'active', 1, NULL)) STORED,  -- helper for uq_qr_one_active; never set it
  generated_by         INT UNSIGNED      NULL,       -- user whose approval published the plant
  generated_at         DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deactivated_at       DATETIME          NULL,
  deactivation_reason  VARCHAR(255)      NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_qr_token (qr_token),
  UNIQUE KEY uq_qr_one_active (plant_id, active_flag),
  CONSTRAINT fk_qr_plant
    FOREIGN KEY (plant_id) REFERENCES plants(id) ON DELETE CASCADE,
  CONSTRAINT fk_qr_generator
    FOREIGN KEY (generated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;


-- One row per scan (phone camera or the app's built-in scanner).
-- user_id is set only when signed-in staff scan with the app.
CREATE TABLE qr_scans (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  qr_code_id   INT UNSIGNED    NOT NULL,
  plant_id     INT UNSIGNED    NOT NULL,   -- denormalised so analytics avoids a join
  user_id      INT UNSIGNED    NULL,       -- NULL for anonymous public scans
  device_type  VARCHAR(30)     NULL,
  ip_hash      CHAR(64)        NULL,       -- hashed, not raw, for privacy
  scanned_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_scan_plant_time (plant_id, scanned_at),
  KEY idx_scan_qr (qr_code_id),
  CONSTRAINT fk_scan_qr
    FOREIGN KEY (qr_code_id) REFERENCES qr_codes(id) ON DELETE CASCADE,
  CONSTRAINT fk_scan_plant
    FOREIGN KEY (plant_id) REFERENCES plants(id) ON DELETE CASCADE,
  CONSTRAINT fk_scan_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;


-- =====================================================================
-- 5. SYSTEM
-- =====================================================================

-- In-app notification list (website and app): new submissions, approvals,
-- rejections and sensor alerts. One row per recipient.
CREATE TABLE notifications (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       INT UNSIGNED    NOT NULL,  -- recipient
  type          VARCHAR(50)     NOT NULL,  -- 'submission.new', 'submission.approved',
                                           -- 'submission.rejected', 'sensor.alert'
  title         VARCHAR(150)    NOT NULL,
  body          VARCHAR(500)    NULL,
  related_type  VARCHAR(40)     NULL,      -- 'plant', 'submission', 'sensor_alert'
  related_id    BIGINT UNSIGNED NULL,
  is_read       TINYINT(1)      NOT NULL DEFAULT 0,
  read_at       DATETIME        NULL,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notif_user (user_id, is_read, created_at),
  CONSTRAINT fk_notif_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;


-- Audit trail for every table, written by the Express API: who changed
-- what, with old and new values. plant_revisions is the field-by-field view
-- botanists read on a plant; this is the full record behind the activity log.
CREATE TABLE audit_logs (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      INT UNSIGNED    NULL,
  action       VARCHAR(40)     NOT NULL,   -- 'create', 'update', 'archive', 'approve',
                                           -- 'reject', 'password_reset', 'role_change'
  entity_type  VARCHAR(40)     NOT NULL,   -- 'plants', 'species', 'users', 'sensor_devices'
  entity_id    BIGINT UNSIGNED NULL,
  old_values   JSON            NULL,
  new_values   JSON            NULL,
  ip_address   VARCHAR(45)     NULL,
  user_agent   VARCHAR(255)    NULL,
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_entity (entity_type, entity_id, created_at),
  KEY idx_audit_user (user_id, created_at),
  CONSTRAINT fk_audit_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;


CREATE TABLE settings (
  setting_key    VARCHAR(60)  NOT NULL,
  setting_value  TEXT         NULL,
  value_type     ENUM('string','int','bool','json') NOT NULL DEFAULT 'string',
  description    VARCHAR(255) NULL,
  updated_by     INT UNSIGNED NULL,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                              ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key),
  CONSTRAINT fk_settings_user
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;


-- Bulk loads, e.g. the initial species dataset.
CREATE TABLE import_jobs (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_type      ENUM('species_csv','plants_csv','images_bulk','qr_bulk') NOT NULL,
  source_file   VARCHAR(255) NULL,
  status        ENUM('queued','running','completed','failed')
                             NOT NULL DEFAULT 'queued',
  total_rows    INT UNSIGNED NOT NULL DEFAULT 0,
  success_rows  INT UNSIGNED NOT NULL DEFAULT 0,
  failed_rows   INT UNSIGNED NOT NULL DEFAULT 0,
  error_log     JSON         NULL,
  run_by        INT UNSIGNED NULL,
  started_at    DATETIME     NULL,
  finished_at   DATETIME     NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_import_status (status, created_at),
  CONSTRAINT fk_import_user
    FOREIGN KEY (run_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;


-- =====================================================================
-- 6. IOT MONITORING (new)
-- =====================================================================
-- A sensor node (ESP32, or the simulator script) POSTs a reading about
-- every 5 minutes with its device code and secret key. The API checks the
-- key, stamps the server time, stores the reading against the sensor and
-- its plant, updates last_seen_at and compares the values with the sensor's
-- limits. A crossed limit opens an alert - unless one is already open for
-- that sensor and reading type - and notifies the rangers, who resolve it
-- with a note. A sensor with no reading for settings.sensor_offline_minutes
-- is shown as Offline.

-- One row per sensor node. Botanists set sensors up: link to a plant, set
-- the safe ranges, issue the device key.
CREATE TABLE sensor_devices (
  id                 INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  device_code        VARCHAR(30)   NOT NULL,   -- sent with every reading, e.g. 'SN-001', 'SIM-01'
  device_key_hash    CHAR(64)      NOT NULL,   -- SHA-256 of the secret key; the key is shown once at set-up
  plant_id           INT UNSIGNED  NULL,       -- monitored plant; NULL = spare / not installed
  label              VARCHAR(120)  NULL,       -- 'Nursery bench 3'
  is_simulated       TINYINT(1)    NOT NULL DEFAULT 0,  -- 1 = simulator script, 0 = real hardware
  is_active          TINYINT(1)    NOT NULL DEFAULT 1,  -- 0 = readings are refused
  -- Alert limits: the plant's safe range, agreed with the botanists.
  -- Same units as sensor_readings. NULL = no limit on that side.
  soil_moisture_min  DECIMAL(5,2)  NULL,       -- %
  soil_moisture_max  DECIMAL(5,2)  NULL,
  temperature_min    DECIMAL(5,2)  NULL,       -- degrees C
  temperature_max    DECIMAL(5,2)  NULL,
  humidity_min       DECIMAL(5,2)  NULL,       -- % relative humidity
  humidity_max       DECIMAL(5,2)  NULL,
  light_min          INT UNSIGNED  NULL,       -- lux (optional)
  light_max          INT UNSIGNED  NULL,
  last_seen_at       DATETIME      NULL,       -- time of the latest reading
  created_by         INT UNSIGNED  NULL,       -- botanist who set it up
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                                   ON UPDATE CURRENT_TIMESTAMP,
  deleted_at         DATETIME      NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sd_code (device_code),
  UNIQUE KEY uq_sd_key (device_key_hash),
  KEY idx_sd_plant (plant_id),
  KEY idx_sd_last_seen (is_active, last_seen_at),
  CONSTRAINT chk_sd_moisture_range    CHECK (soil_moisture_min < soil_moisture_max),
  CONSTRAINT chk_sd_temperature_range CHECK (temperature_min < temperature_max),
  CONSTRAINT chk_sd_humidity_range    CHECK (humidity_min < humidity_max),
  CONSTRAINT chk_sd_light_range       CHECK (light_min < light_max),
  CONSTRAINT fk_sd_plant
    FOREIGN KEY (plant_id) REFERENCES plants(id) ON DELETE SET NULL,
  CONSTRAINT fk_sd_creator
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;


-- About 288 rows per sensor per day. The 24-hour and 7-day charts read one
-- sensor over a time range, hence idx_sr_device_time.
CREATE TABLE sensor_readings (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_id          INT UNSIGNED    NOT NULL,
  plant_id           INT UNSIGNED    NULL,     -- copied from the sensor, so history stays with
                                               -- the right plant if the sensor is moved
  recorded_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,  -- server time
  soil_moisture_pct  DECIMAL(5,2)    NULL,
  temperature_c      DECIMAL(5,2)    NULL,
  humidity_pct       DECIMAL(5,2)    NULL,
  light_lux          INT UNSIGNED    NULL,     -- optional (stretch goal)
  PRIMARY KEY (id),
  KEY idx_sr_device_time (device_id, recorded_at),
  KEY idx_sr_plant_time (plant_id, recorded_at),
  CONSTRAINT chk_sr_has_value
    CHECK (soil_moisture_pct IS NOT NULL OR temperature_c IS NOT NULL
           OR humidity_pct IS NOT NULL OR light_lux IS NOT NULL),
  CONSTRAINT chk_sr_moisture    CHECK (soil_moisture_pct BETWEEN 0 AND 100),
  CONSTRAINT chk_sr_humidity    CHECK (humidity_pct BETWEEN 0 AND 100),
  CONSTRAINT chk_sr_temperature CHECK (temperature_c BETWEEN -40 AND 80),  -- DHT22 range
  CONSTRAINT fk_sr_device
    FOREIGN KEY (device_id) REFERENCES sensor_devices(id) ON DELETE CASCADE,
  CONSTRAINT fk_sr_plant
    FOREIGN KEY (plant_id) REFERENCES plants(id) ON DELETE SET NULL
) ENGINE=InnoDB;


-- Opened when a reading crosses its sensor's limits ('offline' alerts can
-- also be opened by the scheduled offline check). uq_alert_one_open allows
-- at most one OPEN alert per sensor and reading type: a second INSERT fails
-- with duplicate-key error 1062, which the API treats as "already open".
-- Resolved alerts don't count.
CREATE TABLE sensor_alerts (
  id               INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  device_id        INT UNSIGNED    NOT NULL,
  plant_id         INT UNSIGNED    NULL,
  reading_id       BIGINT UNSIGNED NULL,     -- reading that crossed the limit; NULL for 'offline'
  alert_type       ENUM('soil_moisture','temperature','humidity','light','offline')
                                   NOT NULL,
  limit_crossed    ENUM('min','max') NULL,   -- NULL for 'offline'
  reading_value    DECIMAL(9,2)    NULL,
  limit_value      DECIMAL(9,2)    NULL,     -- the limit at the time; limits can change later
  status           ENUM('open','resolved') NOT NULL DEFAULT 'open',
  open_flag        TINYINT UNSIGNED
                   AS (IF(status = 'open', 1, NULL)) STORED,  -- helper for uq_alert_one_open; never set it
  triggered_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_by      INT UNSIGNED    NULL,     -- ranger (or botanist) who dealt with it
  resolved_at      DATETIME        NULL,
  resolution_note  VARCHAR(500)    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_alert_one_open (device_id, alert_type, open_flag),
  KEY idx_alert_status (status, triggered_at),
  KEY idx_alert_plant (plant_id, triggered_at),
  CONSTRAINT chk_alert_resolved
    CHECK (status = 'open' OR resolved_at IS NOT NULL),
  CONSTRAINT fk_alert_device
    FOREIGN KEY (device_id) REFERENCES sensor_devices(id) ON DELETE CASCADE,
  CONSTRAINT fk_alert_plant
    FOREIGN KEY (plant_id) REFERENCES plants(id) ON DELETE SET NULL,
  CONSTRAINT fk_alert_reading
    FOREIGN KEY (reading_id) REFERENCES sensor_readings(id) ON DELETE SET NULL,
  CONSTRAINT fk_alert_resolver
    FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;


-- =====================================================================
-- 7. VIEW - what the public website and app may read
-- =====================================================================
-- Approved, non-deleted plants only, so the public pages cannot read an
-- unapproved record by mistake. Archived plants drop out automatically; the
-- API can still find an archived plant's token in qr_codes and show a
-- "no longer on display" page.
-- Coordinates are public here. If the group decides to hide exact locations
-- of threatened species, return NULL for latitude/longitude in this view
-- when conservation_code is 'VU', 'EN' or 'CR'.
CREATE OR REPLACE VIEW v_public_plants AS
SELECT
  p.id,
  p.plant_code,
  s.id     AS species_id,
  s.scientific_name,
  s.common_name,
  s.local_name,
  s.family,
  s.genus,
  s.growth_form,
  s.description,
  s.characteristics,
  s.leaf_description,
  s.flower_description,
  s.fruit_description,
  s.habitat,
  s.distribution,
  cs.code  AS conservation_code,
  cs.label AS conservation_label,
  p.latitude,
  p.longitude,
  p.site_name,
  p.height_m,
  p.trunk_diameter_cm,
  p.health_status,
  p.life_stage,
  p.morphology_notes,
  p.registered_at,
  p.verified_at,
  p.view_count,
  q.qr_token
FROM plants p
JOIN species s
  ON s.id = p.species_id AND s.deleted_at IS NULL
LEFT JOIN conservation_statuses cs
  ON cs.id = s.conservation_status_id
LEFT JOIN qr_codes q
  ON q.plant_id = p.id AND q.status = 'active'
WHERE p.status = 'approved'
  AND p.deleted_at IS NULL;


-- =====================================================================
-- 8. SEED DATA
-- =====================================================================

INSERT INTO roles (id, name, label, description) VALUES
  (1, 'admin',    'Administrator',    'Manages staff accounts and roles, resets passwords, reviews the activity log'),
  (2, 'ranger',   'Ranger',           'Registers plants for botanist review, prints QR tags, responds to sensor alerts'),
  (3, 'botanist', 'Botanist/Officer', 'Publishes, verifies, edits and archives plant and species records; sets up sensors');

INSERT INTO permissions (code, description) VALUES
  -- Plant Management dashboard
  ('plant.view_all',    'See plant records in any status, not only approved ones'),
  ('plant.create',      'Register a plant and track own submissions (reviewed unless the user also has plant.approve)'),
  ('plant.edit',        'Edit any plant record'),
  ('plant.archive',     'Archive or restore a plant record'),
  ('plant.approve',     'Review queue: approve, or reject with a note. Own entries publish immediately'),
  ('plant.history',     'View the change history of a plant'),
  ('species.manage',    'Add or edit species and their conservation status'),
  ('qr.print',          'Download and print QR tags'),
  ('qr.manage',         'Replace or deactivate a QR code, e.g. a damaged or leaked tag'),
  ('report.view',       'View public error reports (feature not in this release)'),
  ('report.resolve',    'Resolve or dismiss public error reports (feature not in this release)'),
  -- IoT dashboard
  ('sensor.view',       'View the IoT dashboard: readings, charts, sensor list and alerts'),
  ('alert.resolve',     'Resolve sensor alerts with a note'),
  ('sensor.manage',     'Set up sensors: link to a plant, set alert limits, issue device keys'),
  -- Admin dashboard
  ('user.view',         'View staff accounts'),
  ('user.manage',       'Create, edit, activate and deactivate staff accounts; reset passwords'),
  ('user.assign_role',  'Change a staff member''s role'),
  ('system.audit',      'View the activity log and audit trail'),
  -- Held back for the future superuser; until then change settings with SQL
  ('system.settings',   'Change system settings'),
  ('system.import',     'Run bulk imports');

-- admin: accounts only
INSERT INTO role_permissions (role_id, permission_id)
SELECT 1, id FROM permissions WHERE code IN (
  'user.view','user.manage','user.assign_role','system.audit');

-- ranger
INSERT INTO role_permissions (role_id, permission_id)
SELECT 2, id FROM permissions WHERE code IN (
  'plant.create','qr.print','sensor.view','alert.resolve');

-- botanist
INSERT INTO role_permissions (role_id, permission_id)
SELECT 3, id FROM permissions WHERE code IN (
  'plant.view_all','plant.create','plant.edit','plant.archive','plant.approve',
  'plant.history','species.manage','qr.print','qr.manage',
  'report.view','report.resolve',
  'sensor.view','alert.resolve','sensor.manage');

-- FUTURE RELEASE - superuser: one more role holding every permission,
-- with no new tables and no fourth dashboard.
--   INSERT INTO roles (id, name, label, description) VALUES
--     (4, 'superuser', 'Superuser', 'Full system access');
--   INSERT INTO role_permissions (role_id, permission_id)
--   SELECT 4, id FROM permissions;


INSERT INTO conservation_statuses (code, label, sort_order) VALUES
  ('NE', 'Not evaluated',        1),
  ('DD', 'Data deficient',       2),
  ('LC', 'Least concern',        3),
  ('NT', 'Near threatened',      4),
  ('VU', 'Vulnerable',           5),
  ('EN', 'Endangered',           6),
  ('CR', 'Critically endangered',7),
  ('EW', 'Extinct in the wild',  8),
  ('EX', 'Extinct',              9);


-- Starter staff accounts. Replace every password_hash below with a real
-- bcrypt hash before anyone else touches this database.
--   node -e "console.log(require('bcrypt').hashSync('YourPassword', 12))"
INSERT INTO users (role_id, full_name, email, password_hash) VALUES
  (1, 'System Administrator', 'admin@example.com',    '$2b$12$REPLACE_THIS_HASH'),
  (3, 'Demo Botanist',        'botanist@example.com', '$2b$12$REPLACE_THIS_HASH'),
  (2, 'Demo Ranger',          'ranger@example.com',   '$2b$12$REPLACE_THIS_HASH');


INSERT INTO settings (setting_key, setting_value, value_type, description) VALUES
  ('site_name',              'Prototype X', 'string', 'Shown in headers and page titles (placeholder until the product is named)'),
  ('qr_base_url',            'http://localhost:3000/p/', 'string', 'Website plant-page address the QR codes encode, before the token. Set the permanent public URL before printing any tag'),
  ('plant_code_prefix',      'PLT',         'string', 'Prefix for generated Plant IDs'),
  ('require_approval',       'false',       'bool',   'true = ranger entries wait for botanist review; false = they publish immediately. Botanist entries always publish immediately'),
  ('max_upload_mb',          '8',           'int',    'Maximum photo upload size'),
  ('allowed_image_types',    '["image/jpeg","image/png","image/webp"]', 'json', 'Accepted MIME types'),
  ('sensor_offline_minutes', '15',          'int',    'A sensor with no reading for this many minutes is shown as Offline');

-- When the review queue ships, switch approval on for ranger entries:
--   UPDATE settings SET setting_value = 'true' WHERE setting_key = 'require_approval';


-- =====================================================================
-- 9. APPLICATION DATABASE ACCOUNT (optional, run once per server as root)
-- =====================================================================
-- The API connects as this limited account, never as root, and uses
-- parameterised queries only. It can read and write rows but cannot alter
-- or drop tables. Uncomment, choose a long random password, and change
-- 'localhost' to the API server's host if MySQL runs elsewhere.
--
-- CREATE USER IF NOT EXISTS 'plant_api'@'localhost'
--   IDENTIFIED BY 'choose-a-long-random-password';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON plant_registry.* TO 'plant_api'@'localhost';


-- =====================================================================
-- 10. QUERY EXAMPLES FOR THE API
-- =====================================================================

-- Permission check on a protected endpoint (? = user id, permission code)
--   SELECT 1
--   FROM users u
--   JOIN role_permissions rp ON rp.role_id = u.role_id
--   JOIN permissions pm      ON pm.id = rp.permission_id
--   WHERE u.id = ? AND u.is_active = 1 AND u.deleted_at IS NULL
--     AND pm.code = ?;

-- Public search over the five fields: common name, scientific name,
-- Plant ID, family or genus, and location
--   SELECT v.*
--   FROM v_public_plants v
--   JOIN species s ON s.id = v.species_id
--   JOIN plants  p ON p.id = v.id
--   WHERE v.plant_code = ?
--      OR MATCH(s.scientific_name, s.common_name, s.local_name, s.family, s.genus)
--         AGAINST (? IN NATURAL LANGUAGE MODE)
--      OR MATCH(p.site_name, p.location_notes)
--         AGAINST (? IN NATURAL LANGUAGE MODE);

-- Resolve a QR scan to a plant. No row? Check the token's plant status and
-- show "no longer on display" if it is archived.
--   SELECT * FROM v_public_plants WHERE qr_token = ?;
--   SELECT p.status FROM qr_codes q JOIN plants p ON p.id = q.plant_id
--   WHERE q.qr_token = ?;

-- Botanist review queue, oldest first
--   SELECT sub.id, p.plant_code,
--          COALESCE(s.scientific_name, p.proposed_species_name) AS species,
--          p.species_id IS NULL AS species_not_listed,
--          u.full_name AS ranger, sub.submitted_at
--   FROM plant_submissions sub
--   JOIN plants p     ON p.id = sub.plant_id
--   LEFT JOIN species s ON s.id = p.species_id
--   JOIN users u      ON u.id = sub.submitted_by
--   WHERE sub.status = 'pending'
--   ORDER BY sub.submitted_at;

-- A ranger's own submissions
--   SELECT p.plant_code, sub.status, sub.submitted_at, sub.reviewed_at,
--          sub.review_comment
--   FROM plant_submissions sub
--   JOIN plants p ON p.id = sub.plant_id
--   WHERE sub.submitted_by = ?
--   ORDER BY sub.submitted_at DESC;

-- IoT live cards: latest reading and OK / Warning / Offline per sensor
-- (? = settings.sensor_offline_minutes)
--   SELECT d.id, d.device_code, p.plant_code,
--          r.recorded_at, r.soil_moisture_pct, r.temperature_c,
--          r.humidity_pct, r.light_lux,
--          CASE
--            WHEN d.last_seen_at IS NULL
--              OR d.last_seen_at < NOW() - INTERVAL ? MINUTE THEN 'offline'
--            WHEN EXISTS (SELECT 1 FROM sensor_alerts a
--                         WHERE a.device_id = d.id AND a.status = 'open') THEN 'warning'
--            ELSE 'ok'
--          END AS card_status
--   FROM sensor_devices d
--   LEFT JOIN plants p ON p.id = d.plant_id
--   LEFT JOIN sensor_readings r ON r.id = (
--     SELECT r2.id FROM sensor_readings r2
--     WHERE r2.device_id = d.id
--     ORDER BY r2.recorded_at DESC, r2.id DESC LIMIT 1)
--   WHERE d.is_active = 1 AND d.deleted_at IS NULL;

-- 24-hour chart for one sensor
--   SELECT recorded_at, soil_moisture_pct, temperature_c, humidity_pct
--   FROM sensor_readings
--   WHERE device_id = ? AND recorded_at >= NOW() - INTERVAL 24 HOUR
--   ORDER BY recorded_at;

-- 7-day chart for one sensor, hourly averages
--   SELECT DATE_FORMAT(recorded_at, '%Y-%m-%d %H:00') AS hour_start,
--          ROUND(AVG(soil_moisture_pct), 1) AS soil_moisture_pct,
--          ROUND(AVG(temperature_c), 1)     AS temperature_c,
--          ROUND(AVG(humidity_pct), 1)      AS humidity_pct
--   FROM sensor_readings
--   WHERE device_id = ? AND recorded_at >= NOW() - INTERVAL 7 DAY
--   GROUP BY hour_start
--   ORDER BY hour_start;

-- Open an alert after storing a reading. Error 1062 on uq_alert_one_open
-- means one is already open for that sensor and reading type: skip it.
--   INSERT INTO sensor_alerts
--     (device_id, plant_id, reading_id, alert_type, limit_crossed,
--      reading_value, limit_value)
--   VALUES (?, ?, ?, 'soil_moisture', 'min', ?, ?);

-- Resolve an alert
--   UPDATE sensor_alerts
--   SET status = 'resolved', resolved_by = ?, resolved_at = NOW(),
--       resolution_note = ?
--   WHERE id = ? AND status = 'open';

-- Scheduled offline check (? = settings.sensor_offline_minutes)
--   SELECT id, device_code, plant_id
--   FROM sensor_devices
--   WHERE is_active = 1 AND deleted_at IS NULL AND plant_id IS NOT NULL
--     AND (last_seen_at IS NULL
--          OR last_seen_at < NOW() - INTERVAL ? MINUTE);

-- Admin activity log: who changed what, newest first
--   SELECT a.created_at, u.full_name, a.action, a.entity_type, a.entity_id
--   FROM audit_logs a
--   LEFT JOIN users u ON u.id = a.user_id
--   ORDER BY a.created_at DESC
--   LIMIT 50;
