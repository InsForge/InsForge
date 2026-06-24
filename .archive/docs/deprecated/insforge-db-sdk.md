# InsForge Database SDK

## Setup
```javascript
import { createClient } from '@insforge/sdk';
const client = createClient({ baseUrl: 'http://localhost:7130' });
```

## Query Builder

### from(table)
```javascript
client.database.from('posts')  // Returns QueryBuilder
```

## Operations

### select
```javascript
.select()              // All columns
.select('id, title')   // Specific columns
.select('*, user:user_id(name, email)')  // Foreign key expansion
```

### insert
```javascript
.insert({ title: 'Hello' }).select()     // Single record with data returned
.insert([{...}, {...}]).select()         // Multiple records with data returned
// Note: Always sends array to API
// Without .select(), returns null data
```

### update
```javascript
.update({ title: 'Updated' }).eq('id', '123').select()
// Must chain with filter and .select() to return data
```

### delete
```javascript
.delete().eq('id', '123').select()
// Must chain with filter and .select() to return data
```

### upsert
```javascript
.upsert({ id: '123', title: 'New or Update' }).select()
// Updates if exists, inserts if not
// Use .select() to return data
```

## Filters

```javascript
.eq('col', value)      // column = value
.neq('col', value)     // column != value
.gt('col', value)      // column > value
.gte('col', value)     // column >= value
.lt('col', value)      // column < value
.lte('col', value)     // column <= value
.like('col', '%pat%')  // LIKE pattern
.ilike('col', '%pat%') // ILIKE pattern
.is('col', null)       // IS NULL
.in('col', [1,2,3])    // IN array

.or('status.eq.active,status.eq.pending')  // OR condition
.and('price.gte.100,price.lte.500')        // Explicit AND
.not('deleted', 'is.true')                 // NOT condition
```

### OR Examples
```javascript
// Simple OR
.or('status.eq.active,status.eq.pending')
// WHERE status = 'active' OR status = 'pending'

// OR with other filters (implicit AND)
.eq('user_id', '123')
.or('status.eq.draft,status.eq.published')
// WHERE user_id = '123' AND (status = 'draft' OR status = 'published')

// Complex OR with NOT
.or('age.lt.18,age.gt.65,not.is_active.is.true')
// WHERE age < 18 OR age > 65 OR NOT is_active
```

## Modifiers

```javascript
.order('col')                        // ASC
.order('col', { ascending: false })  // DESC
.limit(10)
.offset(20)
.range(0, 9)                         // Headers: Range: 0-9
.single()                            // Return object not array
.count('exact')                      // Include total count
```

## Execute

```javascript
// Methods are thenable
const { data, error } = await client.database
  .from('posts')
  .select()
  .eq('user_id', '123')
  .limit(10);

// data: array or null
// error: { message, statusCode, code } or null
```

## Foreign Key Expansion

```javascript
// PostgREST syntax
.select('*, user:user_id(name, email)')

// Response:
{
  id: '123',
  title: 'Post',
  user_id: '456',
  user: { name: 'John', email: 'john@example.com' }
}
```

## Users Table

```javascript
// Profile data (not auth)
await client.database.from('users').select().eq('id', userId).single()
await client.database.from('users').update({ nickname, avatar_url }).eq('id', userId).select()
```

## Notes
- Uses PostgREST under the hood
- POST requires array format `[{...}]`
- All methods return QueryBuilder for chaining
- Execute returns `{ data, error }`