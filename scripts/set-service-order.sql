-- Script to set display order for existing services
-- Update the order values as needed for your services

-- Set SVC001 to order 1
UPDATE "Service" SET "order" = 1 WHERE "code" = 'SVC001';

-- Set SVC002 (Bill Payment) to order 2
UPDATE "Service" SET "order" = 2 WHERE "code" = 'SVC002';

-- Set SVC003 to order 3
UPDATE "Service" SET "order" = 3 WHERE "code" = 'SVC003';

-- Add more services as needed:
-- UPDATE "Service" SET "order" = 4 WHERE "code" = 'SVC004';
-- UPDATE "Service" SET "order" = 5 WHERE "code" = 'SVC005';

-- View current service order
SELECT "code", "title", "order", "isActive" 
FROM "Service" 
ORDER BY "order" ASC;
