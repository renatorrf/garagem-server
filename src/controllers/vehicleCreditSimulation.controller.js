"use strict";

const VehicleCreditSimulationService = require("../services/VehicleCreditSimulationService");

function getSchemaFromRequest(req) {
  return (
    req.headers["x-tenant-schema"] ||
    req.headers.schema ||
    req.body?.schema ||
    process.env.SCHEMA_PADRAO ||
    "nextcar"
  );
}

exports.listBanks = (_req, res) => {
  return res.json({
    success: true,
    data: VehicleCreditSimulationService.getBanks(),
  });
};

exports.simulate = async (req, res) => {
  try {
    const result = await VehicleCreditSimulationService.simulate(req.body || {}, {
      schema: getSchemaFromRequest(req),
    });

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Falha ao simular credito.",
    });
  }
};
