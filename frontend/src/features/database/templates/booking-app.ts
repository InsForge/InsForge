import { DatabaseTemplate } from './index';

export const bookingAppTemplate: DatabaseTemplate = {
  id: 'booking-app',
  title: 'Booking App',
  description: 'A booking and reservation system with services, bookings, and reviews',
  tableCount: 3,
  visualizerSchema: [
    {
      tableName: 'services',
      columns: [
        { columnName: 'id', type: 'uuid', isPrimaryKey: true, isNullable: false, isUnique: true },
        {
          columnName: 'provider_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
          foreignKey: {
            referenceTable: 'users',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'name',
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
          columnName: 'price',
          type: 'decimal',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
        },
        {
          columnName: 'duration_minutes',
          type: 'integer',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
        },
        {
          columnName: 'image_url',
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
      ],
    },
    {
      tableName: 'bookings',
      columns: [
        { columnName: 'id', type: 'uuid', isPrimaryKey: true, isNullable: false, isUnique: true },
        {
          columnName: 'service_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
          foreignKey: {
            referenceTable: 'services',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'customer_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
          foreignKey: {
            referenceTable: 'users',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'scheduled_at',
          type: 'timestamp',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
        },
        {
          columnName: 'status',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
        },
        {
          columnName: 'total_price',
          type: 'decimal',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
        },
        {
          columnName: 'notes',
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
      ],
    },
    {
      tableName: 'reviews',
      columns: [
        { columnName: 'id', type: 'uuid', isPrimaryKey: true, isNullable: false, isUnique: true },
        {
          columnName: 'booking_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: true,
          foreignKey: {
            referenceTable: 'bookings',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'service_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
          foreignKey: {
            referenceTable: 'services',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'customer_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
          foreignKey: {
            referenceTable: 'users',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'rating',
          type: 'integer',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
        },
        {
          columnName: 'comment',
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
      ],
    },
  ],
  sql: `-- Booking App Database Schema
-- A comprehensive booking and reservation system with services, bookings, and reviews

-- Services table
CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  price DECIMAL(10, 2) NOT NULL CHECK (price >= 0),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  image_url VARCHAR(500),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Bookings table
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMP NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  total_price DECIMAL(10, 2) NOT NULL CHECK (total_price >= 0),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Reviews table
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID UNIQUE NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX idx_services_provider ON services(provider_id);
CREATE INDEX idx_services_active ON services(is_active);
CREATE INDEX idx_bookings_service ON bookings(service_id);
CREATE INDEX idx_bookings_customer ON bookings(customer_id);
CREATE INDEX idx_bookings_scheduled ON bookings(scheduled_at);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_bookings_created ON bookings(created_at DESC);
CREATE INDEX idx_reviews_service ON reviews(service_id);
CREATE INDEX idx_reviews_customer ON reviews(customer_id);
CREATE INDEX idx_reviews_rating ON reviews(rating);

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

-- Function to check booking time slot availability
CREATE OR REPLACE FUNCTION is_time_slot_available(
  service_id_param UUID,
  scheduled_at_param TIMESTAMP,
  duration_minutes_param INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
  conflict_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO conflict_count
  FROM bookings b
  JOIN services s ON b.service_id = s.id
  WHERE b.service_id = service_id_param
    AND b.status IN ('pending', 'confirmed')
    AND (
      -- Check if new booking overlaps with existing bookings
      (scheduled_at_param >= b.scheduled_at
       AND scheduled_at_param < b.scheduled_at + INTERVAL '1 minute' * s.duration_minutes)
      OR
      (scheduled_at_param + INTERVAL '1 minute' * duration_minutes_param > b.scheduled_at
       AND scheduled_at_param + INTERVAL '1 minute' * duration_minutes_param <= b.scheduled_at + INTERVAL '1 minute' * s.duration_minutes)
      OR
      (scheduled_at_param <= b.scheduled_at
       AND scheduled_at_param + INTERVAL '1 minute' * duration_minutes_param >= b.scheduled_at + INTERVAL '1 minute' * s.duration_minutes)
    );

  RETURN conflict_count = 0;
END;
$$ LANGUAGE plpgsql;

-- Function to get service average rating
CREATE OR REPLACE FUNCTION get_service_average_rating(service_id_param UUID)
RETURNS DECIMAL AS $$
DECLARE
  avg_rating DECIMAL;
BEGIN
  SELECT COALESCE(ROUND(AVG(rating), 2), 0) INTO avg_rating
  FROM reviews
  WHERE service_id = service_id_param;
  RETURN avg_rating;
END;
$$ LANGUAGE plpgsql;

-- Function to get service review count
CREATE OR REPLACE FUNCTION get_service_review_count(service_id_param UUID)
RETURNS INTEGER AS $$
DECLARE
  review_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO review_count
  FROM reviews
  WHERE service_id = service_id_param;
  RETURN review_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get provider booking statistics
CREATE OR REPLACE FUNCTION get_provider_booking_stats(provider_id_param UUID)
RETURNS TABLE(
  total_bookings BIGINT,
  completed_bookings BIGINT,
  cancelled_bookings BIGINT,
  total_revenue DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) as total_bookings,
    COUNT(*) FILTER (WHERE b.status = 'completed') as completed_bookings,
    COUNT(*) FILTER (WHERE b.status = 'cancelled') as cancelled_bookings,
    COALESCE(SUM(b.total_price) FILTER (WHERE b.status = 'completed'), 0) as total_revenue
  FROM bookings b
  JOIN services s ON b.service_id = s.id
  WHERE s.provider_id = provider_id_param;
END;
$$ LANGUAGE plpgsql;

-- Function to get customer booking history
CREATE OR REPLACE FUNCTION get_customer_booking_history(customer_id_param UUID)
RETURNS TABLE(
  total_bookings BIGINT,
  completed_bookings BIGINT,
  upcoming_bookings BIGINT,
  total_spent DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) as total_bookings,
    COUNT(*) FILTER (WHERE status = 'completed') as completed_bookings,
    COUNT(*) FILTER (WHERE status IN ('pending', 'confirmed') AND scheduled_at > NOW()) as upcoming_bookings,
    COALESCE(SUM(total_price) FILTER (WHERE status = 'completed'), 0) as total_spent
  FROM bookings
  WHERE customer_id = customer_id_param;
END;
$$ LANGUAGE plpgsql;

-- Function to get popular services
CREATE OR REPLACE FUNCTION get_popular_services(limit_count INTEGER DEFAULT 10)
RETURNS TABLE(
  service_id UUID,
  service_name VARCHAR,
  booking_count BIGINT,
  average_rating DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id as service_id,
    s.name as service_name,
    COUNT(b.id) as booking_count,
    COALESCE(ROUND(AVG(r.rating), 2), 0) as average_rating
  FROM services s
  LEFT JOIN bookings b ON s.id = b.service_id
  LEFT JOIN reviews r ON s.id = r.service_id
  WHERE s.is_active = TRUE
  GROUP BY s.id, s.name
  ORDER BY booking_count DESC, average_rating DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- =======================
-- TRIGGERS
-- =======================

-- Trigger to update updated_at on services
CREATE TRIGGER update_services_updated_at
  BEFORE UPDATE ON services
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger to update updated_at on bookings
CREATE TRIGGER update_bookings_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =======================
-- ROW LEVEL SECURITY (RLS)
-- =======================

-- Enable RLS on all tables
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Policies for services (anyone can view active services)
CREATE POLICY "Anyone can view active services"
  ON services FOR SELECT
  USING (is_active = TRUE);

CREATE POLICY "Providers can create their own services"
  ON services FOR INSERT
  TO authenticated
  WITH CHECK (provider_id = auth.uid());

CREATE POLICY "Providers can update their own services"
  ON services FOR UPDATE
  TO authenticated
  USING (provider_id = auth.uid())
  WITH CHECK (provider_id = auth.uid());

CREATE POLICY "Providers can delete their own services"
  ON services FOR DELETE
  TO authenticated
  USING (provider_id = auth.uid());

-- Policies for bookings (customers see their bookings, providers see bookings for their services)
CREATE POLICY "Customers can view their own bookings"
  ON bookings FOR SELECT
  TO authenticated
  USING (
    customer_id = auth.uid()
    OR
    service_id IN (SELECT id FROM services WHERE provider_id = auth.uid())
  );

CREATE POLICY "Customers can create bookings"
  ON bookings FOR INSERT
  TO authenticated
  WITH CHECK (customer_id = auth.uid());

CREATE POLICY "Customers and providers can update bookings"
  ON bookings FOR UPDATE
  TO authenticated
  USING (
    customer_id = auth.uid()
    OR
    service_id IN (SELECT id FROM services WHERE provider_id = auth.uid())
  );

CREATE POLICY "Customers can cancel their bookings"
  ON bookings FOR DELETE
  TO authenticated
  USING (customer_id = auth.uid());

-- Policies for reviews
CREATE POLICY "Anyone can view reviews"
  ON reviews FOR SELECT
  USING (true);

CREATE POLICY "Customers can create reviews for their bookings"
  ON reviews FOR INSERT
  TO authenticated
  WITH CHECK (
    customer_id = auth.uid()
    AND
    booking_id IN (
      SELECT id FROM bookings
      WHERE customer_id = auth.uid() AND status = 'completed'
    )
  );

CREATE POLICY "Customers can update their own reviews"
  ON reviews FOR UPDATE
  TO authenticated
  USING (customer_id = auth.uid())
  WITH CHECK (customer_id = auth.uid());

CREATE POLICY "Customers can delete their own reviews"
  ON reviews FOR DELETE
  TO authenticated
  USING (customer_id = auth.uid());`,
};
