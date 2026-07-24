
import express from "express";

const router = express.Router();

router.get("/hello", (req, res) => {
  res.json({message:"Movies route"});
});


router.post("/hello", (req, res) => {
  res.json({message:"Movies route"});
});

router.put("/hello", (req, res) => {
  res.json({message:"Movies route"});
});

router.delete("/hello", (req, res) => {
  res.json({message:"Movies route"});
});


export default router;
