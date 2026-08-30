"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.citiesRouter = void 0;
const express_1 = require("express");
const cities_1 = require("../../db/cities");
exports.citiesRouter = (0, express_1.Router)();
// Публичный, без авторизации — справочник городов нужен ещё до входа
// (например, для фильтра на публичной витрине).
exports.citiesRouter.get('/', (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    if (!query) {
        res.json({ cities: cities_1.CITIES });
        return;
    }
    res.json({ cities: (0, cities_1.searchCities)(query, 30) });
});
