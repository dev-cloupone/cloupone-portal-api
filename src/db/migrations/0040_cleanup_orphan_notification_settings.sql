DELETE FROM "project_notification_settings" pns
WHERE NOT EXISTS (
  SELECT 1 FROM "project_allocations" pa
  WHERE pa."project_id" = pns."project_id"
    AND pa."user_id" = pns."user_id"
);
