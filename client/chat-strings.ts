// Text for the General section, in every language Paseo's app offers (Settings, Language).
// English is required and is the fallback: a language Paseo adds later shows English until
// this file gains it, and a missing key in one language shows its English text.
import { defineTranslations } from "@getpaseo/plugin/client";

const en = {
  title: "General",
  newChat: "New chat",
  untitled: "New chat",
  empty: "Talk about anything, outside any project",
  showMore: "Show {{n}} more",
  showLess: "Show less",
  openFailed: "Couldn't open the chat folder",
};

const zhCN = {
  title: "通用",
  newChat: "新对话",
  untitled: "新对话",
  empty: "不属于任何项目，随便聊",
  showMore: "再显示 {{n}} 个",
  showLess: "收起",
  openFailed: "无法打开对话文件夹",
};

const ptBR = {
  title: "Geral",
  newChat: "Novo chat",
  untitled: "Novo chat",
  empty: "Converse sobre qualquer coisa, fora de qualquer projeto",
  showMore: "Mostrar mais {{n}}",
  showLess: "Mostrar menos",
  openFailed: "Não foi possível abrir a pasta do chat",
};

export const chatText = defineTranslations({
  resources: {
    en,
    ko: {
      title: "일반",
      newChat: "새 대화",
      untitled: "새 대화",
      empty: "프로젝트와 상관없이 무엇이든 이야기하세요",
      showMore: "{{n}}개 더 보기",
      showLess: "접기",
      openFailed: "대화 폴더를 열지 못했습니다",
    },
    ja: {
      title: "一般",
      newChat: "新しいチャット",
      untitled: "新しいチャット",
      empty: "プロジェクトに関係なく自由に話せます",
      showMore: "さらに {{n}} 件表示",
      showLess: "折りたたむ",
      openFailed: "チャットフォルダを開けませんでした",
    },
    "zh-CN": zhCN,
    // Base codes too, in case the app reports a language without its region.
    zh: zhCN,
    es: {
      title: "General",
      newChat: "Nuevo chat",
      untitled: "Nuevo chat",
      empty: "Habla de cualquier cosa, fuera de cualquier proyecto",
      showMore: "Mostrar {{n}} más",
      showLess: "Mostrar menos",
      openFailed: "No se pudo abrir la carpeta del chat",
    },
    fr: {
      title: "Général",
      newChat: "Nouvelle discussion",
      untitled: "Nouvelle discussion",
      empty: "Parlez de tout, en dehors de tout projet",
      showMore: "Afficher {{n}} de plus",
      showLess: "Afficher moins",
      openFailed: "Impossible d'ouvrir le dossier de discussion",
    },
    "pt-BR": ptBR,
    pt: ptBR,
    ru: {
      title: "Общее",
      newChat: "Новый чат",
      untitled: "Новый чат",
      empty: "Говорите о чём угодно, вне проектов",
      showMore: "Показать ещё {{n}}",
      showLess: "Свернуть",
      openFailed: "Не удалось открыть папку чата",
    },
    ar: {
      title: "عام",
      newChat: "محادثة جديدة",
      untitled: "محادثة جديدة",
      empty: "تحدّث عن أي شيء خارج أي مشروع",
      showMore: "عرض {{n}} أخرى",
      showLess: "عرض أقل",
      openFailed: "تعذّر فتح مجلد المحادثة",
    },
  },
});
