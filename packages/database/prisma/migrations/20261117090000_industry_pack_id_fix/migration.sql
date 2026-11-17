-- industry_pack_id was never set from the chosen industry (it always kept its default 'real_estate'), so every workspace looked like
-- a real-estate one. Only real estate has its own pack today; every other industry uses the general pack. This corrects the label that
-- decides which optional modules (e.g. Properties) the menu shows; it does not touch existing pipelines, leads or custom fields.
UPDATE tenants SET industry_pack_id = 'general' WHERE industry <> 'real_estate' AND industry_pack_id = 'real_estate';
