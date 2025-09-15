import { Routes, Route, Navigate } from "react-router-dom";
import SurahList from "./SurahList";
import SurahView from "./SurahView";
import QuizView from "./QuizView";

export default function KidsSurahRoute() {
  return (
    <Routes>
      <Route index element={<SurahList/>} />
      <Route path=":chapter" element={<SurahView/>} />
      <Route path=":chapter/quiz" element={<QuizView/>} />
      <Route path="*" element={<Navigate to="/kids-suras" replace />} />
    </Routes>
  );
}
