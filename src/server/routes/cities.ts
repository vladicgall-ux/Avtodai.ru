import { Router } from 'express';
import { CITIES, searchCities } from '../../db/cities';

export const citiesRouter = Router();

// Публичный, без авторизации — справочник городов нужен ещё до входа
// (например, для фильтра на публичной витрине).
citiesRouter.get('/', (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  if (!query) {
    res.json({ cities: CITIES });
    return;
  }
  res.json({ cities: searchCities(query, 30) });
});
