import { DatabaseTemplate } from './index';

export const crmSystemTemplate: DatabaseTemplate = {
  id: 'crm-system',
  title: 'CRM',
  description: 'A simple CRM for managing contacts, companies, deals, tasks, and follow ups',
  tableCount: 4,
  visualizerSchema: [
    {
      tableName: 'companies',
      columns: [
        { columnName: 'id', type: 'uuid', isPrimaryKey: true, isNullable: false, isUnique: true },
        {
          columnName: 'name',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
        },
        {
          columnName: 'industry',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'website',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'phone',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'email',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'address',
          type: 'text',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'created_at',
          type: 'timestamp',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'updated_at',
          type: 'timestamp',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
      ],
    },
    {
      tableName: 'contacts',
      columns: [
        { columnName: 'id', type: 'uuid', isPrimaryKey: true, isNullable: false, isUnique: true },
        {
          columnName: 'company_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
          foreignKey: {
            referenceTable: 'companies',
            referenceColumn: 'id',
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'first_name',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
        },
        {
          columnName: 'last_name',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
        },
        {
          columnName: 'email',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: true,
        },
        {
          columnName: 'phone',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'position',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'created_at',
          type: 'timestamp',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'updated_at',
          type: 'timestamp',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
      ],
    },
    {
      tableName: 'deals',
      columns: [
        { columnName: 'id', type: 'uuid', isPrimaryKey: true, isNullable: false, isUnique: true },
        {
          columnName: 'company_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
          foreignKey: {
            referenceTable: 'companies',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'contact_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
          foreignKey: {
            referenceTable: 'contacts',
            referenceColumn: 'id',
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'title',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
        },
        {
          columnName: 'amount',
          type: 'decimal',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'status',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'close_date',
          type: 'date',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'created_at',
          type: 'timestamp',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'updated_at',
          type: 'timestamp',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
      ],
    },
    {
      tableName: 'activities',
      columns: [
        { columnName: 'id', type: 'uuid', isPrimaryKey: true, isNullable: false, isUnique: true },
        {
          columnName: 'contact_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
          foreignKey: {
            referenceTable: 'contacts',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'deal_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
          foreignKey: {
            referenceTable: 'deals',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'type',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
        },
        {
          columnName: 'subject',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
        },
        {
          columnName: 'description',
          type: 'text',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'scheduled_at',
          type: 'timestamp',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'completed_at',
          type: 'timestamp',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'created_at',
          type: 'timestamp',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
      ],
    },
  ],
  sql: `-- CRM System Database Schema
-- A comprehensive CRM system with companies, contacts, deals, and activities

-- Companies table
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  industry VARCHAR(100),
  website VARCHAR(255),
  phone VARCHAR(50),
  email VARCHAR(255),
  address TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Contacts table
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(50),
  position VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Deals table
CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  amount DECIMAL(15, 2),
  status VARCHAR(50) DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
  close_date DATE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Activities table
CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL CHECK (type IN ('call', 'email', 'meeting', 'note')),
  subject VARCHAR(255) NOT NULL,
  description TEXT,
  scheduled_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX idx_contacts_company ON contacts(company_id);
CREATE INDEX idx_contacts_email ON contacts(email);
CREATE INDEX idx_deals_company ON deals(company_id);
CREATE INDEX idx_deals_contact ON deals(contact_id);
CREATE INDEX idx_deals_status ON deals(status);
CREATE INDEX idx_deals_close_date ON deals(close_date);
CREATE INDEX idx_activities_contact ON activities(contact_id);
CREATE INDEX idx_activities_deal ON activities(deal_id);
CREATE INDEX idx_activities_type ON activities(type);
CREATE INDEX idx_activities_scheduled ON activities(scheduled_at);

-- =======================
-- DATABASE FUNCTIONS
-- =======================

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to get full contact name
CREATE OR REPLACE FUNCTION get_contact_full_name(contact_id UUID)
RETURNS VARCHAR AS $$
DECLARE
  full_name VARCHAR;
BEGIN
  SELECT CONCAT(first_name, ' ', last_name) INTO full_name
  FROM contacts
  WHERE id = contact_id;
  RETURN full_name;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate total deal value for a company
CREATE OR REPLACE FUNCTION get_company_total_deal_value(company_id_param UUID)
RETURNS DECIMAL AS $$
DECLARE
  total_value DECIMAL;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO total_value
  FROM deals
  WHERE company_id = company_id_param AND status = 'won';
  RETURN total_value;
END;
$$ LANGUAGE plpgsql;

-- Function to get contact activity count
CREATE OR REPLACE FUNCTION get_contact_activity_count(contact_id_param UUID)
RETURNS INTEGER AS $$
DECLARE
  activity_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO activity_count
  FROM activities
  WHERE contact_id = contact_id_param;
  RETURN activity_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get deal pipeline summary
CREATE OR REPLACE FUNCTION get_deal_pipeline_summary()
RETURNS TABLE(
  status VARCHAR,
  deal_count BIGINT,
  total_value DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.status,
    COUNT(*) as deal_count,
    COALESCE(SUM(d.amount), 0) as total_value
  FROM deals d
  GROUP BY d.status
  ORDER BY d.status;
END;
$$ LANGUAGE plpgsql;

-- =======================
-- TRIGGERS
-- =======================

-- Trigger to update updated_at on companies
CREATE TRIGGER update_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger to update updated_at on contacts
CREATE TRIGGER update_contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger to update updated_at on deals
CREATE TRIGGER update_deals_updated_at
  BEFORE UPDATE ON deals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =======================
-- ROW LEVEL SECURITY (RLS)
-- =======================

-- Enable RLS on all tables
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

-- Policies for companies (allow all operations for authenticated users)
CREATE POLICY "Allow authenticated users to view companies"
  ON companies FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to create companies"
  ON companies FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update companies"
  ON companies FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to delete companies"
  ON companies FOR DELETE
  TO authenticated
  USING (true);

-- Policies for contacts
CREATE POLICY "Allow authenticated users to view contacts"
  ON contacts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to create contacts"
  ON contacts FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update contacts"
  ON contacts FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to delete contacts"
  ON contacts FOR DELETE
  TO authenticated
  USING (true);

-- Policies for deals
CREATE POLICY "Allow authenticated users to view deals"
  ON deals FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to create deals"
  ON deals FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update deals"
  ON deals FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to delete deals"
  ON deals FOR DELETE
  TO authenticated
  USING (true);

-- Policies for activities
CREATE POLICY "Allow authenticated users to view activities"
  ON activities FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to create activities"
  ON activities FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update activities"
  ON activities FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to delete activities"
  ON activities FOR DELETE
  TO authenticated
  USING (true);

-- =======================
-- SEED DATA
-- =======================

-- Insert sample companies
INSERT INTO companies (name, industry, website, phone, email, address) VALUES
  ('Acme Corporation', 'Technology', 'https://acme-corp.example', '+1-555-0100', 'info@acme-corp.example', '123 Tech Street, San Francisco, CA 94105'),
  ('TechStart Inc', 'Software', 'https://techstart.example', '+1-555-0101', 'contact@techstart.example', '456 Innovation Ave, Austin, TX 78701'),
  ('Global Solutions Ltd', 'Consulting', 'https://globalsolutions.example', '+1-555-0102', 'hello@globalsolutions.example', '789 Business Blvd, New York, NY 10001'),
  ('Innovation Labs', 'Research', 'https://innovationlabs.example', '+1-555-0103', 'info@innovationlabs.example', '321 Science Park, Boston, MA 02101'),
  ('Enterprise Systems Co', 'Enterprise Software', 'https://enterprisesys.example', '+1-555-0104', 'sales@enterprisesys.example', '654 Commerce Dr, Seattle, WA 98101');

-- Insert sample contacts
INSERT INTO contacts (company_id, first_name, last_name, email, phone, position) VALUES
  ((SELECT id FROM companies WHERE name = 'Acme Corporation'), 'John', 'Smith', 'john.smith@acme-corp.example', '+1-555-0200', 'CEO'),
  ((SELECT id FROM companies WHERE name = 'Acme Corporation'), 'Sarah', 'Johnson', 'sarah.johnson@acme-corp.example', '+1-555-0201', 'CTO'),
  ((SELECT id FROM companies WHERE name = 'TechStart Inc'), 'Michael', 'Williams', 'michael.williams@techstart.example', '+1-555-0202', 'Founder'),
  ((SELECT id FROM companies WHERE name = 'TechStart Inc'), 'Emily', 'Brown', 'emily.brown@techstart.example', '+1-555-0203', 'VP of Sales'),
  ((SELECT id FROM companies WHERE name = 'Global Solutions Ltd'), 'David', 'Davis', 'david.davis@globalsolutions.example', '+1-555-0204', 'Managing Partner'),
  ((SELECT id FROM companies WHERE name = 'Innovation Labs'), 'Jennifer', 'Miller', 'jennifer.miller@innovationlabs.example', '+1-555-0205', 'Director of Research'),
  ((SELECT id FROM companies WHERE name = 'Innovation Labs'), 'Robert', 'Wilson', 'robert.wilson@innovationlabs.example', '+1-555-0206', 'Senior Scientist'),
  ((SELECT id FROM companies WHERE name = 'Enterprise Systems Co'), 'Lisa', 'Anderson', 'lisa.anderson@enterprisesys.example', '+1-555-0207', 'VP of Sales'),
  ((SELECT id FROM companies WHERE name = 'Enterprise Systems Co'), 'James', 'Taylor', 'james.taylor@enterprisesys.example', '+1-555-0208', 'Account Manager');

-- Insert sample deals
INSERT INTO deals (company_id, contact_id, title, amount, status, close_date) VALUES
  ((SELECT id FROM companies WHERE name = 'Acme Corporation'), (SELECT id FROM contacts WHERE email = 'john.smith@acme-corp.example'), 'Enterprise License Agreement', 150000.00, 'won', '2025-10-15'),
  ((SELECT id FROM companies WHERE name = 'TechStart Inc'), (SELECT id FROM contacts WHERE email = 'emily.brown@techstart.example'), 'Cloud Infrastructure Setup', 75000.00, 'open', '2025-12-01'),
  ((SELECT id FROM companies WHERE name = 'Global Solutions Ltd'), (SELECT id FROM contacts WHERE email = 'david.davis@globalsolutions.example'), 'Consulting Services Package', 120000.00, 'open', '2025-11-20'),
  ((SELECT id FROM companies WHERE name = 'Innovation Labs'), (SELECT id FROM contacts WHERE email = 'jennifer.miller@innovationlabs.example'), 'Research Partnership', 200000.00, 'won', '2025-09-30'),
  ((SELECT id FROM companies WHERE name = 'Enterprise Systems Co'), (SELECT id FROM contacts WHERE email = 'lisa.anderson@enterprisesys.example'), 'Software Integration Project', 95000.00, 'open', '2025-12-15'),
  ((SELECT id FROM companies WHERE name = 'Acme Corporation'), (SELECT id FROM contacts WHERE email = 'sarah.johnson@acme-corp.example'), 'Technical Support Contract', 45000.00, 'lost', '2025-10-01'),
  ((SELECT id FROM companies WHERE name = 'TechStart Inc'), (SELECT id FROM contacts WHERE email = 'michael.williams@techstart.example'), 'Custom Development', 180000.00, 'won', '2025-10-20');

-- Insert sample activities
INSERT INTO activities (contact_id, deal_id, type, subject, description, scheduled_at, completed_at) VALUES
  ((SELECT id FROM contacts WHERE email = 'john.smith@acme-corp.example'),
   (SELECT id FROM deals WHERE title = 'Enterprise License Agreement'),
   'meeting', 'Initial Discovery Call', 'Discussed requirements and project scope', '2025-09-15 10:00:00', '2025-09-15 11:00:00'),

  ((SELECT id FROM contacts WHERE email = 'emily.brown@techstart.example'),
   (SELECT id FROM deals WHERE title = 'Cloud Infrastructure Setup'),
   'email', 'Proposal Follow-up', 'Sent detailed proposal and pricing', '2025-10-20 14:30:00', '2025-10-20 14:30:00'),

  ((SELECT id FROM contacts WHERE email = 'david.davis@globalsolutions.example'),
   (SELECT id FROM deals WHERE title = 'Consulting Services Package'),
   'call', 'Budget Discussion', 'Reviewed budget constraints and timeline', '2025-10-25 15:00:00', '2025-10-25 15:45:00'),

  ((SELECT id FROM contacts WHERE email = 'jennifer.miller@innovationlabs.example'),
   (SELECT id FROM deals WHERE title = 'Research Partnership'),
   'meeting', 'Contract Signing', 'Finalized partnership agreement', '2025-09-28 13:00:00', '2025-09-28 14:30:00'),

  ((SELECT id FROM contacts WHERE email = 'lisa.anderson@enterprisesys.example'),
   (SELECT id FROM deals WHERE title = 'Software Integration Project'),
   'meeting', 'Technical Requirements Meeting', 'Gathering technical specifications', '2025-11-12 10:00:00', NULL),

  ((SELECT id FROM contacts WHERE email = 'sarah.johnson@acme-corp.example'),
   NULL,
   'call', 'Quarterly Check-in', 'Regular relationship building call', '2025-11-05 11:00:00', NULL),

  ((SELECT id FROM contacts WHERE email = 'michael.williams@techstart.example'),
   (SELECT id FROM deals WHERE title = 'Custom Development'),
   'email', 'Project Kickoff Details', 'Sent project timeline and milestones', '2025-10-22 09:00:00', '2025-10-22 09:00:00'),

  ((SELECT id FROM contacts WHERE email = 'robert.wilson@innovationlabs.example'),
   NULL,
   'note', 'Conference Networking', 'Met at Tech Conference 2025, interested in AI solutions', '2025-10-18 16:00:00', '2025-10-18 16:00:00'),

  ((SELECT id FROM contacts WHERE email = 'james.taylor@enterprisesys.example'),
   (SELECT id FROM deals WHERE title = 'Software Integration Project'),
   'meeting', 'Demo Presentation', 'Product demonstration scheduled', '2025-11-18 14:00:00', NULL),

  ((SELECT id FROM contacts WHERE email = 'emily.brown@techstart.example'),
   (SELECT id FROM deals WHERE title = 'Cloud Infrastructure Setup'),
   'call', 'Security Requirements Review', 'Discuss compliance and security needs', '2025-11-08 10:30:00', NULL);`,
};
