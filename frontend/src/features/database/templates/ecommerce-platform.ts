import { DatabaseTemplate } from './index';

export const ecommercePlatformTemplate: DatabaseTemplate = {
  id: 'ecommerce-platform',
  title: 'E-commerce',
  description:
    'An online store with product listings, carts, checkout, and owner product management',
  tableCount: 5,
  visualizerSchema: [
    {
      tableName: 'products',
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
          columnName: 'sku',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: true,
        },
        {
          columnName: 'stock_quantity',
          type: 'integer',
          isPrimaryKey: false,
          isNullable: true,
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
          columnName: 'category',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'is_active',
          type: 'boolean',
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
      tableName: 'customers',
      columns: [
        { columnName: 'id', type: 'uuid', isPrimaryKey: true, isNullable: false, isUnique: true },
        {
          columnName: 'user_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: true,
          foreignKey: {
            referenceTable: 'auth.users',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
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
          columnName: 'phone',
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
          columnName: 'city',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'country',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'postal_code',
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
      tableName: 'orders',
      columns: [
        { columnName: 'id', type: 'uuid', isPrimaryKey: true, isNullable: false, isUnique: true },
        {
          columnName: 'customer_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
          foreignKey: {
            referenceTable: 'customers',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'status',
          type: 'varchar',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
        },
        {
          columnName: 'total_amount',
          type: 'decimal',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
        },
        {
          columnName: 'shipping_address',
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
      tableName: 'order_items',
      columns: [
        { columnName: 'id', type: 'uuid', isPrimaryKey: true, isNullable: false, isUnique: true },
        {
          columnName: 'order_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
          foreignKey: {
            referenceTable: 'orders',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'product_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
          foreignKey: {
            referenceTable: 'products',
            referenceColumn: 'id',
            onDelete: 'RESTRICT',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'quantity',
          type: 'integer',
          isPrimaryKey: false,
          isNullable: false,
          isUnique: false,
        },
        {
          columnName: 'unit_price',
          type: 'decimal',
          isPrimaryKey: false,
          isNullable: false,
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
          columnName: 'product_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
          foreignKey: {
            referenceTable: 'products',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'customer_id',
          type: 'uuid',
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
          foreignKey: {
            referenceTable: 'customers',
            referenceColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        },
        {
          columnName: 'rating',
          type: 'integer',
          isPrimaryKey: false,
          isNullable: true,
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
  sql: `-- E-commerce Database Schema
-- A complete e-commerce platform with products, customers, orders, and reviews

-- Products table
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(10, 2) NOT NULL CHECK (price >= 0),
  sku VARCHAR(100) UNIQUE NOT NULL,
  stock_quantity INTEGER DEFAULT 0 CHECK (stock_quantity >= 0),
  image_url VARCHAR(500),
  category VARCHAR(100),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Customers table (extends users with customer-specific data)
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(50),
  address TEXT,
  city VARCHAR(100),
  country VARCHAR(100),
  postal_code VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Orders table
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled')),
  total_amount DECIMAL(10, 2) NOT NULL CHECK (total_amount >= 0),
  shipping_address TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Order items table
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON UPDATE CASCADE ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price DECIMAL(10, 2) NOT NULL CHECK (unit_price >= 0),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Reviews table
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON UPDATE CASCADE ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(product_id, customer_id)
);

-- Create indexes for better performance
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_products_active ON products(is_active);
CREATE INDEX idx_customers_user ON customers(user_id);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created ON orders(created_at DESC);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);
CREATE INDEX idx_reviews_product ON reviews(product_id);
CREATE INDEX idx_reviews_customer ON reviews(customer_id);
CREATE INDEX idx_reviews_rating ON reviews(rating);

-- =======================
-- ROW LEVEL SECURITY (RLS)
-- =======================

-- Enable RLS on all tables
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Policies for products (public read, authenticated write)
CREATE POLICY "Anyone can view active products"
  ON products FOR SELECT
  USING (is_active = TRUE OR auth.role() = 'admin');

CREATE POLICY "Authenticated users can create products"
  ON products FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update products"
  ON products FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete products"
  ON products FOR DELETE
  TO authenticated
  USING (true);

-- Policies for customers (users can only see their own data)
CREATE POLICY "Users can view their own customer data"
  ON customers FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create their own customer data"
  ON customers FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own customer data"
  ON customers FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Policies for orders (customers can only see their own orders)
CREATE POLICY "Customers can view their own orders"
  ON orders FOR SELECT
  TO authenticated
  USING (
    customer_id IN (
      SELECT id FROM customers WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Customers can create their own orders"
  ON orders FOR INSERT
  TO authenticated
  WITH CHECK (
    customer_id IN (
      SELECT id FROM customers WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Customers can update their own orders"
  ON orders FOR UPDATE
  TO authenticated
  USING (
    customer_id IN (
      SELECT id FROM customers WHERE user_id = auth.uid()
    )
  );

-- Policies for order_items
CREATE POLICY "Customers can view their order items"
  ON order_items FOR SELECT
  TO authenticated
  USING (
    order_id IN (
      SELECT o.id FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE c.user_id = auth.uid()
    )
  );

CREATE POLICY "Customers can create order items for their orders"
  ON order_items FOR INSERT
  TO authenticated
  WITH CHECK (
    order_id IN (
      SELECT o.id FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE c.user_id = auth.uid()
    )
  );

-- Policies for reviews
CREATE POLICY "Anyone can view reviews"
  ON reviews FOR SELECT
  USING (true);

CREATE POLICY "Customers can create their own reviews"
  ON reviews FOR INSERT
  TO authenticated
  WITH CHECK (
    customer_id IN (
      SELECT id FROM customers WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Customers can update their own reviews"
  ON reviews FOR UPDATE
  TO authenticated
  USING (
    customer_id IN (
      SELECT id FROM customers WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Customers can delete their own reviews"
  ON reviews FOR DELETE
  TO authenticated
  USING (
    customer_id IN (
      SELECT id FROM customers WHERE user_id = auth.uid()
    )
  );

-- =======================
-- SEED DATA
-- =======================

-- Insert sample products
INSERT INTO products (name, description, price, sku, stock_quantity, category, image_url) VALUES
  ('Wireless Bluetooth Headphones', 'Premium noise-cancelling wireless headphones with 30-hour battery life', 149.99, 'AUDIO-WH-001', 50, 'Electronics', 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e'),
  ('Smart Fitness Watch', 'Track your fitness goals with GPS, heart rate monitor, and sleep tracking', 299.99, 'WATCH-SF-001', 35, 'Electronics', 'https://images.unsplash.com/photo-1523275335684-37898b6baf30'),
  ('Ergonomic Office Chair', 'Comfortable mesh office chair with lumbar support and adjustable armrests', 399.99, 'FURN-CH-001', 20, 'Furniture', 'https://images.unsplash.com/photo-1580480055273-228ff5388ef8'),
  ('Stainless Steel Water Bottle', 'Insulated 32oz water bottle keeps drinks cold for 24 hours', 29.99, 'HOME-WB-001', 100, 'Home & Kitchen', 'https://images.unsplash.com/photo-1602143407151-7111542de6e8'),
  ('Yoga Mat with Carrying Strap', 'Premium non-slip yoga mat, eco-friendly and easy to clean', 49.99, 'SPORT-YM-001', 75, 'Sports', 'https://images.unsplash.com/photo-1601925260368-ae2f83cf8b7f'),
  ('LED Desk Lamp', 'Adjustable brightness desk lamp with USB charging port', 45.99, 'HOME-DL-001', 60, 'Home & Kitchen', 'https://images.unsplash.com/photo-1513506003901-1e6a229e2d15'),
  ('Portable Power Bank 20000mAh', 'Fast-charging portable battery pack with dual USB ports', 39.99, 'ELEC-PB-001', 80, 'Electronics', 'https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5'),
  ('Running Shoes', 'Lightweight running shoes with responsive cushioning', 119.99, 'SHOE-RS-001', 45, 'Sports', 'https://images.unsplash.com/photo-1542291026-7eec264c27ff'),
  ('Laptop Backpack', 'Water-resistant backpack with padded laptop compartment up to 15.6"', 79.99, 'BAG-LB-001', 55, 'Accessories', 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62'),
  ('Organic Green Tea (100 bags)', 'Premium organic green tea bags, rich in antioxidants', 19.99, 'FOOD-GT-001', 120, 'Food & Beverage', 'https://images.unsplash.com/photo-1564890369478-c89ca6d9cde9'),
  ('Wireless Gaming Mouse', 'High-precision gaming mouse with customizable RGB lighting', 69.99, 'ELEC-GM-001', 40, 'Electronics', 'https://images.unsplash.com/photo-1527814050087-3793815479db'),
  ('Plant-Based Protein Powder', 'Chocolate flavored vegan protein powder, 2lb container', 44.99, 'FOOD-PP-001', 65, 'Food & Beverage', 'https://images.unsplash.com/photo-1579722821273-0f6c7d44362f'),
  ('Ceramic Coffee Mug Set (4 pack)', 'Handcrafted ceramic mugs, microwave and dishwasher safe', 34.99, 'HOME-CM-001', 90, 'Home & Kitchen', 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d'),
  ('Resistance Bands Set', '5-piece resistance band set with different resistance levels', 24.99, 'SPORT-RB-001', 110, 'Sports', 'https://images.unsplash.com/photo-1598289431512-b97b0917affc'),
  ('Bamboo Cutting Board', 'Large bamboo cutting board with juice groove', 32.99, 'HOME-CB-001', 70, 'Home & Kitchen', 'https://images.unsplash.com/photo-1594018426677-e62f2752292f');`,
};
