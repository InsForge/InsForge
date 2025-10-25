export async function validateModelId(modelId: string): Promise<boolean> {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
      });
  
      if (!response.ok) {
        console.warn('⚠️ Failed to fetch models from OpenRouter');
        return false;
      }
  
      const data: unknown = await response.json();
  
      // Defensive runtime check: OpenRouter API should return { data: Array<{ id: string }> }
      if (
        typeof data !== 'object' ||
        data === null ||
        !Array.isArray((data as any).data)
      ) {
        console.warn(' Unexpected response structure from OpenRouter');
        return false;
      }
  
      const models = (data as { data: Array<{ id: string }> }).data;
      return models.some((m) => typeof m.id === 'string' && m.id === modelId);
  
    } catch (err) {
      console.error('Error validating modelId:', err);
      return false;
    }
  }
  