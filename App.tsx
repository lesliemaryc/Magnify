import TextRecognition from '@react-native-ml-kit/text-recognition';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Reanimated, { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import Svg, { Polyline } from 'react-native-svg';
import { isGeminiConfigured, recognizeAndTranslateHighlightedWord, translateMedicineSummary, translateMedicineWord } from './src/gemini';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  Linking,
  LogBox,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

LogBox.ignoreAllLogs();

type Screen = 'camera' | 'scan';
type Tab = 'label' | 'summary';
type SummaryLanguage = 'en' | 'ko' | 'es' | 'ja';
type TranslationLanguage = 'off' | 'ko' | 'es' | 'ja';
type Frame = { left: number; top: number; width: number; height: number };
type SwipePoint = { x: number; y: number };
type WordBox = { id: string; text: string; frame: Frame; contours?: SwipePoint[][] };
type SummarySection = { title: string; icon: string; color: string; content: string };
type VisualWordStatus = { wordId: string; state: 'analyzing' | 'complete' | 'failed' };
type StoredAnalysis = {
  fullText: string;
  words: WordBox[];
  aiSections?: SummarySection[];
  koreanSections?: SummarySection[];
  easyReadTranslations?: Partial<Record<SummaryLanguage, SummarySection[]>>;
  translations: Record<string, string>;
  updatedAt: string;
};
type StoredSnapshot = { id: string; uri: string; width: number; height: number; createdAt: string; analysis?: StoredAnalysis };

const COLORS = {
  navy: '#17242B',
  teal: '#0F766E',
  mint: '#E4F3EF',
  canvas: '#F7F8F7',
  orange: '#E97924',
  white: '#FFFFFF',
};

const TRANSLATION_LANGUAGES: Array<{ id: TranslationLanguage; label: string; promptName?: string }> = [
  { id: 'off', label: 'Off' },
  { id: 'ko', label: '한국어', promptName: 'Korean' },
  { id: 'es', label: 'Español', promptName: 'Spanish' },
  { id: 'ja', label: '日本語', promptName: 'Japanese' },
];

const snapshotDirectory = new Directory(Paths.document, 'medicine-label-snapshots');
const snapshotIndexFile = new File(snapshotDirectory, 'index.json');

const KOREAN_WORDS: Record<string, string> = {
  active: '활성', ingredient: '성분', ingredients: '성분', inactive: '비활성',
  directions: '복용 방법', dosage: '복용량', dose: '복용량', take: '복용하다',
  tablet: '정제', tablets: '정제', capsule: '캡슐', capsules: '캡슐',
  warning: '경고', warnings: '경고', danger: '위험', doctor: '의사',
  children: '어린이', child: '어린이', adults: '성인', adult: '성인',
  pain: '통증', fever: '발열', relief: '완화', use: '사용', uses: '용도',
  daily: '매일', hours: '시간', hour: '시간', water: '물', food: '음식',
  before: '전에', after: '후에', with: '함께', without: '없이',
  store: '보관하다', storage: '보관', temperature: '온도', keep: '보관하다',
  away: '멀리', stop: '중단하다', ask: '문의하다', poison: '독성 물질',
  acetaminophen: '아세트아미노펜', ibuprofen: '이부프로펜', aspirin: '아스피린',
  sodium: '나트륨', alcohol: '알코올', allergy: '알레르기', allergic: '알레르기가 있는',
  pregnant: '임신한', breastfeeding: '수유 중인', expiration: '유효기간',
};

const supportsNativeGlass = Platform.OS === 'ios' && isGlassEffectAPIAvailable();

function GlassSurface({ children, style, dark = false, interactive = false }: { children: React.ReactNode; style?: any; dark?: boolean; interactive?: boolean }) {
  if (supportsNativeGlass) {
    return (
      <GlassView
        colorScheme={dark ? 'dark' : 'light'}
        glassEffectStyle="clear"
        isInteractive={interactive}
        tintColor={dark ? 'rgba(12,18,18,0.60)' : 'rgba(247,251,250,0.56)'}
        style={style}
      >
        {children}
      </GlassView>
    );
  }
  return <View style={[style, dark ? styles.glassFallbackDark : styles.glassFallbackLight]}>{children}</View>;
}

export default function App() {
  return <GestureHandlerRootView style={{ flex: 1 }}><MagMedApp /></GestureHandlerRootView>;
}

function MagMedApp() {
  const [screen, setScreen] = useState<Screen>('camera');
  const [tab, setTab] = useState<Tab>('label');
  const [imageUri, setImageUri] = useState<string>();
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const [words, setWords] = useState<WordBox[]>([]);
  const [fullText, setFullText] = useState('');
  const [selectedWord, setSelectedWord] = useState<WordBox>();
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string>();
  const [aiSections, setAISections] = useState<SummarySection[]>();
  const [summaryLanguage, setSummaryLanguage] = useState<SummaryLanguage>('en');
  const [easyReadTranslations, setEasyReadTranslations] = useState<Partial<Record<SummaryLanguage, SummarySection[]>>>({});
  const [translatingSummary, setTranslatingSummary] = useState(false);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translatingWord, setTranslatingWord] = useState<string>();
  const [visualWordStatus, setVisualWordStatus] = useState<VisualWordStatus>();
  const [translationLanguage, setTranslationLanguage] = useState<TranslationLanguage>('off');
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [storedSnapshots, setStoredSnapshots] = useState<StoredSnapshot[]>([]);
  const [activeSnapshotId, setActiveSnapshotId] = useState<string>();
  const translationRequests = useRef(new Set<string>());
  const easyReadTranslationRequests = useRef(new Map<Exclude<SummaryLanguage, 'en'>, Promise<SummarySection[]>>());
  const summaryLanguageSelectionId = useRef(0);
  const scanRequestId = useRef(0);

  const localSections = useMemo(() => summarizeLabel(fullText), [fullText]);
  // Easy Read is a complete transcription, not a summary. Keep the full
  // on-device OCR text as the source of truth so AI cannot condense or omit
  // label wording. summarizeLabel only groups and styles these original lines.
  const sections = localSections;

  useEffect(() => {
    loadStoredSnapshots().then(setStoredSnapshots).catch((reason) => console.warn('Could not load stored snapshots.', reason));
  }, []);

  useEffect(() => {
    if (!activeSnapshotId || scanning || !fullText.trim()) return;
    const analysis: StoredAnalysis = {
      fullText,
      words,
      aiSections,
      koreanSections: easyReadTranslations.ko,
      easyReadTranslations,
      translations,
      updatedAt: new Date().toISOString(),
    };
    const saveTimer = setTimeout(() => {
      updateStoredSnapshotAnalysis(activeSnapshotId, analysis)
        .then((updated) => {
          if (updated) setStoredSnapshots((current) => current.map((snapshot) => snapshot.id === updated.id ? updated : snapshot));
        })
        .catch((reason) => console.warn('Could not save analyzed label data.', reason));
    }, 250);
    return () => clearTimeout(saveTimer);
  }, [activeSnapshotId, scanning, fullText, words, aiSections, easyReadTranslations, translations]);

  const requestEasyReadTranslation = (language: Exclude<SummaryLanguage, 'en'>, sourceSections: SummarySection[]) => {
    const existing = easyReadTranslationRequests.current.get(language);
    if (existing) return existing;
    const languageName = { ko: 'Korean', es: 'Spanish', ja: 'Japanese' }[language];
    const request = translateMedicineSummary(
      sourceSections.map(({ title, content }) => ({ title, content })),
      languageName,
    ).then((translated) => {
      const prepared = translated.flatMap((item, index) => {
        const source = sourceSections.find((section) => section.title === item.sourceTitle) ?? sourceSections[index];
        return source ? [{ ...source, title: item.title, content: item.content }] : [];
      });
      if (prepared.length === 0) throw new Error(`Gemini returned no matching ${languageName} Easy Read sections`);
      return prepared;
    }).finally(() => {
      easyReadTranslationRequests.current.delete(language);
    });
    easyReadTranslationRequests.current.set(language, request);
    return request;
  };

  const chooseImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Please allow photo access in Settings.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    await scanImage(result.assets[0].uri, result.assets[0].width, result.assets[0].height);
  };

  const scanImage = async (uri: string, width: number, height: number, shouldStore = true, storedSnapshotId?: string) => {
    const requestId = ++scanRequestId.current;
    setImageUri(uri);
    setImageSize({ width, height });
    setWords([]);
    setFullText('');
    setSelectedWord(undefined);
    setAISections(undefined);
    setSummaryLanguage('en');
    setEasyReadTranslations({});
    setTranslatingSummary(false);
    setTranslations({});
    setVisualWordStatus(undefined);
    translationRequests.current.clear();
    easyReadTranslationRequests.current.clear();
    summaryLanguageSelectionId.current += 1;
    setError(undefined);
    setScanning(true);
    setTab('label');
    setScreen('scan');
    setActiveSnapshotId(storedSnapshotId);

    if (shouldStore) {
      storeSnapshot(uri, width, height)
        .then((snapshot) => {
          setActiveSnapshotId(snapshot.id);
          setStoredSnapshots((current) => [snapshot, ...current.filter((item) => item.id !== snapshot.id)].slice(0, 50));
        })
        .catch((reason) => console.warn('Could not store snapshot.', reason));
    }

    try {
      const result: any = await TextRecognition.recognize(uri);
      const found = extractWordBoxes(result);
      const recognizedText = result.text ?? '';
      setFullText(recognizedText);
      setWords(found);
      const readyTranslations: Record<string, string> = {};
      found.forEach((word) => {
        const key = translationKey(word.text);
        const dictionaryKey = word.text.toLowerCase().replace(/[^a-z]/g, '');
        if (key && KOREAN_WORDS[dictionaryKey]) readyTranslations[translationCacheKey(key, 'ko')] = KOREAN_WORDS[dictionaryKey];
      });
      setTranslations(readyTranslations);
      if (isGeminiConfigured && recognizedText.trim()) {
        const sourceSections = summarizeLabel(recognizedText);
        (['ko', 'es', 'ja'] as Array<Exclude<SummaryLanguage, 'en'>>).forEach((language) => {
          requestEasyReadTranslation(language, sourceSections)
            .then((translatedSections) => {
              if (scanRequestId.current !== requestId) return;
              setEasyReadTranslations((current) => ({ ...current, [language]: translatedSections }));
            })
            .catch((reason) => console.warn(`Background ${language} Easy Read translation unavailable.`, reason));
        });
      }
      if (!result.text?.trim()) {
        setError('No readable text was found. Try a brighter, sharper photo.');
      }
    } catch (reason) {
      console.warn(reason);
      setError('The label could not be read. Try taking the photo straight above the package.');
    } finally {
      setScanning(false);
    }
  };

  const reset = () => {
    scanRequestId.current += 1;
    setScreen('camera');
    setImageUri(undefined);
    setWords([]);
    setFullText('');
    setError(undefined);
    setAISections(undefined);
    setSummaryLanguage('en');
    setEasyReadTranslations({});
    setVisualWordStatus(undefined);
    setActiveSnapshotId(undefined);
    easyReadTranslationRequests.current.clear();
    summaryLanguageSelectionId.current += 1;
  };

  const selectWord = async (word: WordBox, highlightedFrame?: Frame) => {
    setSelectedWord(word);
    setVisualWordStatus(highlightedFrame ? { wordId: word.id, state: 'analyzing' } : undefined);

    if (highlightedFrame && imageUri) {
      try {
        const padding = Math.max(4, highlightedFrame.height * 0.3);
        const crop = clampFrameToImage({
          left: highlightedFrame.left - padding,
          top: highlightedFrame.top - padding,
          width: highlightedFrame.width + padding * 2,
          height: highlightedFrame.height + padding * 2,
        }, imageSize);
        const ocrScale = Math.min(8, Math.max(1, 150 / Math.max(crop.height, 1)));
        const ocrWidth = Math.min(2400, Math.max(600, Math.round(crop.width * ocrScale)));
        const croppedImage = await manipulateAsync(
          imageUri,
          [
            { crop: { originX: crop.left, originY: crop.top, width: crop.width, height: crop.height } },
            { resize: { width: ocrWidth } },
          ],
          { base64: true, compress: 1, format: SaveFormat.JPEG },
        );
        const ocrResult: any = await TextRecognition.recognize(croppedImage.uri);
        const detected = chooseHighlightedOcrWord(
          extractWordBoxes(ocrResult),
          croppedImage.width,
          croppedImage.height,
          word.text,
        );
        if (detected?.text.trim()) {
          const detectedFrame = clampFrameToImage({
            left: crop.left + detected.frame.left * (crop.width / croppedImage.width),
            top: crop.top + detected.frame.top * (crop.height / croppedImage.height),
            width: detected.frame.width * (crop.width / croppedImage.width),
            height: detected.frame.height * (crop.height / croppedImage.height),
          }, imageSize);
          const refinedWord = { ...word, text: detected.text.trim(), frame: detectedFrame, contours: undefined };
          setWords((current) => current.some((item) => item.id === word.id)
            ? current.map((item) => item.id === word.id ? refinedWord : item)
            : [...current, refinedWord]);
          setSelectedWord((current) => current?.id === word.id ? refinedWord : current);
          await selectWord(refinedWord);
          setVisualWordStatus((current) => current?.wordId === word.id ? { wordId: word.id, state: 'complete' } : current);
          return;
        }

        if (isGeminiConfigured && croppedImage.base64) {
          const language = TRANSLATION_LANGUAGES.find((item) => item.id === translationLanguage);
          const visualResult = await recognizeAndTranslateHighlightedWord(
            croppedImage.base64,
            word.text,
            fullText,
            language?.promptName,
          );
          if (visualResult.sourceText.trim()) {
            const detectedFrame = frameFromNormalizedCropBox(visualResult.boundingBox, crop) ?? highlightedFrame;
            const refinedWord = {
              ...word,
              text: visualResult.sourceText.trim(),
              frame: detectedFrame,
              contours: undefined,
            };
            setWords((current) => current.some((item) => item.id === word.id)
              ? current.map((item) => item.id === word.id ? refinedWord : item)
              : [...current, refinedWord]);
            setSelectedWord((current) => current?.id === word.id ? refinedWord : current);
            if (translationLanguage !== 'off' && visualResult.translation.trim()) {
              const detectedKey = translationCacheKey(refinedWord.text, translationLanguage);
              setTranslations((current) => ({ ...current, [detectedKey]: visualResult.translation.trim() }));
            }
            setVisualWordStatus({ wordId: word.id, state: 'complete' });
            return;
          }
        }
      } catch (ocrError) {
        console.warn('Highlighted word OCR unavailable; using full-image OCR.', ocrError);
      }
      // If the close crop cannot be read, retain the word from the full-image
      // on-device OCR instead of sending unrelated pixels to Gemini.
      await selectWord(word);
      setVisualWordStatus((current) => current?.wordId === word.id ? { wordId: word.id, state: 'complete' } : current);
      return;
    }

    if (highlightedFrame && !word.text.trim()) return;
    const key = translationKey(word.text) || translationKey(word.id);
    const language = TRANSLATION_LANGUAGES.find((item) => item.id === translationLanguage);
    const translationEnabled = translationLanguage !== 'off' && Boolean(language?.promptName);
    const cacheKey = translationCacheKey(key, translationLanguage);
    if (!key) return;
    if (!translationEnabled && word.text.trim()) {
      setVisualWordStatus(highlightedFrame ? { wordId: word.id, state: 'complete' } : undefined);
      return;
    }
    if (translationEnabled && translations[cacheKey] && !highlightedFrame) return;

    // Numbers and dosage symbols do not need a network round trip.
    if (!/[a-z]/i.test(word.text) && !highlightedFrame) {
      if (translationEnabled) setTranslations((current) => ({ ...current, [cacheKey]: word.text }));
      return;
    }

    const dictionaryKey = word.text.toLowerCase().replace(/[^a-z]/g, '');
    const local = translationLanguage === 'ko' ? KOREAN_WORDS[dictionaryKey] : undefined;
    if (translationEnabled && local && !translations[cacheKey]) {
      // Show a useful translation beside the word immediately. Gemini then
      // replaces it with the context-aware result when the request finishes.
      setTranslations((current) => ({ ...current, [cacheKey]: local }));
      if (highlightedFrame) setVisualWordStatus({ wordId: word.id, state: 'complete' });
    } else if (translationEnabled && translations[cacheKey] && highlightedFrame) {
      setVisualWordStatus({ wordId: word.id, state: 'complete' });
    }

    if (highlightedFrame && translationEnabled && word.text.trim() && (local || translations[cacheKey])) return;

    if (!isGeminiConfigured) {
      if (translationEnabled) setTranslations((current) => ({ ...current, [cacheKey]: local ?? 'Translation unavailable' }));
      if (highlightedFrame) setVisualWordStatus({ wordId: word.id, state: 'failed' });
      return;
    }

    if (highlightedFrame && translationEnabled && word.text.trim()) {
      const textRequestKey = `text:${cacheKey}`;
      if (translationRequests.current.has(textRequestKey)) return;
      translationRequests.current.add(textRequestKey);
      setTranslatingWord(cacheKey);
      try {
        const translated = await translateMedicineWord(word.text, language?.promptName ?? 'Korean');
        setTranslations((current) => ({ ...current, [cacheKey]: translated.trim() }));
        setVisualWordStatus((current) => current?.wordId === word.id ? { wordId: word.id, state: 'complete' } : current);
      } catch (translationError) {
        console.warn('Gemini word translation unavailable.', translationError);
        setVisualWordStatus((current) => current?.wordId === word.id ? { wordId: word.id, state: 'failed' } : current);
      } finally {
        setTranslatingWord((current) => current === cacheKey ? undefined : current);
        translationRequests.current.delete(textRequestKey);
      }
      return;
    }

    const requestKey = highlightedFrame
      ? `visual:${translationLanguage}:${word.id}:${Math.round(highlightedFrame.left)}:${Math.round(highlightedFrame.top)}:${Math.round(highlightedFrame.width)}:${Math.round(highlightedFrame.height)}`
      : cacheKey;
    if (translationRequests.current.has(requestKey)) return;
    translationRequests.current.add(requestKey);

    if (translationEnabled && !translations[cacheKey] && !local) setTranslatingWord(cacheKey);
    let visualTranslationCompleted = false;
    let quickTranslationSucceeded = false;
    const quickTranslation = translationEnabled && word.text.trim() && !translations[cacheKey] && !local
      ? translateMedicineWord(word.text, language?.promptName ?? 'Korean')
        .then((translated) => {
          if (!visualTranslationCompleted && translated.trim()) {
            quickTranslationSucceeded = true;
            setTranslations((current) => ({ ...current, [cacheKey]: translated.trim() }));
            setTranslatingWord((current) => current === cacheKey ? undefined : current);
            setVisualWordStatus((current) => current?.wordId === word.id ? { wordId: word.id, state: 'complete' } : current);
          }
        })
        .catch((reason) => console.warn('Quick word translation unavailable.', reason))
      : undefined;
    try {
      if (highlightedFrame && imageUri) {
        const crop = clampFrameToImage(highlightedFrame, imageSize);
        const croppedImage = await manipulateAsync(
          imageUri,
          [
            { crop: { originX: crop.left, originY: crop.top, width: crop.width, height: crop.height } },
            { resize: { width: 1024 } },
          ],
          { base64: true, compress: 1, format: SaveFormat.JPEG },
        );
        if (!croppedImage.base64) throw new Error('Highlighted crop did not include image data');
        const ocrHint = word.id.startsWith('press-') ? '' : word.text;
        const result = await recognizeAndTranslateHighlightedWord(croppedImage.base64, ocrHint, fullText, language?.promptName);
        const sourceText = result.sourceText.trim() || word.text;
        const detectedKey = translationKey(sourceText) || key;
        const visualFrame = frameFromNormalizedCropBox(result.boundingBox, crop) ?? word.frame;
        const detectedFrame = completeWordFrame(visualFrame, word, sourceText, words, imageSize);
        const detectedContours = contoursFromNormalizedCrop(result.contours, crop);
        visualTranslationCompleted = true;
        if (translationEnabled && result.translation.trim()) {
          setTranslations((current) => ({
            ...current,
            [cacheKey]: result.translation,
            [translationCacheKey(detectedKey, translationLanguage)]: result.translation,
          }));
          setTranslatingWord((current) => current === cacheKey ? undefined : current);
        }
        setWords((current) => {
          const detectedWord: WordBox = { id: word.id, text: sourceText, frame: detectedFrame, contours: detectedContours.length ? detectedContours : undefined };
          const existingIndex = current.findIndex((item) => item.id === word.id);
          if (existingIndex < 0) return [...current, detectedWord];
          return current.map((item, index) => index === existingIndex ? detectedWord : item);
        });
        setSelectedWord((current) => current?.id === word.id ? { ...current, text: sourceText, frame: detectedFrame, contours: detectedContours.length ? detectedContours : undefined } : current);
        setVisualWordStatus((current) => current?.wordId === word.id ? { wordId: word.id, state: 'complete' } : current);
      } else if (translationEnabled) {
        const translated = await translateMedicineWord(word.text, language?.promptName ?? 'Korean');
        setTranslations((current) => ({ ...current, [cacheKey]: translated }));
      }
    } catch (translationError) {
      console.warn('Gemini translation unavailable.', translationError);
      if (quickTranslation) await quickTranslation;
      if (translationEnabled && !quickTranslation) setTranslations((current) => ({ ...current, [cacheKey]: local ?? 'Translation unavailable' }));
      if (highlightedFrame) {
        const hasFastResult = Boolean(local || translations[cacheKey] || quickTranslationSucceeded);
        setVisualWordStatus((current) => current?.wordId === word.id ? { wordId: word.id, state: hasFastResult ? 'complete' : 'failed' } : current);
      }
    } finally {
      if (quickTranslation) await quickTranslation;
      setTranslatingWord((current) => current === cacheKey ? undefined : current);
      if (highlightedFrame) translationRequests.current.delete(requestKey);
    }
  };

  const changeSummaryLanguage = async (language: SummaryLanguage) => {
    const selectionId = ++summaryLanguageSelectionId.current;
    setSummaryLanguage(language);
    if (language === 'en' || easyReadTranslations[language]) {
      setTranslatingSummary(false);
      return;
    }
    if (!isGeminiConfigured) {
      Alert.alert('Translation unavailable', 'Configure the Gemini API key to translate Easy Read.');
      setSummaryLanguage('en');
      return;
    }
    setTranslatingSummary(true);
    try {
      const prepared = await requestEasyReadTranslation(language, sections);
      setEasyReadTranslations((current) => ({ ...current, [language]: prepared }));
    } catch (translationError) {
      console.warn('Easy Read translation unavailable.', translationError);
      if (summaryLanguageSelectionId.current === selectionId) {
        Alert.alert('Translation unavailable', 'Could not translate Easy Read right now. Please try again.');
        setSummaryLanguage('en');
      }
    } finally {
      if (summaryLanguageSelectionId.current === selectionId) setTranslatingSummary(false);
    }
  };

  const changeLabelTranslationLanguage = (language: TranslationLanguage) => {
    setTranslationLanguage(language);
    setSelectedWord(undefined);
    setVisualWordStatus(undefined);
  };

  const clearSelectedWord = () => {
    setSelectedWord(undefined);
    setVisualWordStatus(undefined);
    setTranslatingWord(undefined);
  };

  const openStoredSnapshot = (snapshot: StoredSnapshot) => {
    scanRequestId.current += 1;
    setSettingsVisible(false);
    if (!snapshot.analysis) {
      scanImage(snapshot.uri, snapshot.width, snapshot.height, false, snapshot.id);
      return;
    }
    setImageUri(snapshot.uri);
    setImageSize({ width: snapshot.width, height: snapshot.height });
    setWords(snapshot.analysis.words);
    setFullText(snapshot.analysis.fullText);
    setSelectedWord(undefined);
    setAISections(snapshot.analysis.aiSections);
    setEasyReadTranslations({
      ...(snapshot.analysis.easyReadTranslations ?? {}),
      ...(snapshot.analysis.koreanSections ? { ko: snapshot.analysis.koreanSections } : {}),
    });
    setTranslations(snapshot.analysis.translations);
    setSummaryLanguage('en');
    setTranslatingSummary(false);
    setTranslatingWord(undefined);
    setVisualWordStatus(undefined);
    translationRequests.current.clear();
    easyReadTranslationRequests.current.clear();
    summaryLanguageSelectionId.current += 1;
    setError(undefined);
    setScanning(false);
    setTab('label');
    setScreen('scan');
    setActiveSnapshotId(snapshot.id);
  };

  const requestDeleteSnapshot = (snapshot: StoredSnapshot) => {
    deleteStoredSnapshot(snapshot.id)
      .then((updated) => {
        setStoredSnapshots(updated);
        if (activeSnapshotId === snapshot.id) {
          setActiveSnapshotId(undefined);
        }
      })
      .catch((reason) => {
        console.warn('Could not delete stored snapshot.', reason);
        Alert.alert('Could not delete snapshot', 'Please try again.');
      });
  };

  const settingsSheet = (
    <SettingsSheet
      visible={settingsVisible}
      translationLanguage={translationLanguage}
      snapshots={storedSnapshots}
      onClose={() => setSettingsVisible(false)}
      onTranslationLanguageChange={changeLabelTranslationLanguage}
      onOpenSnapshot={openStoredSnapshot}
      onDeleteSnapshot={requestDeleteSnapshot}
    />
  );

  if (screen === 'camera') {
    return (
      <View style={styles.flex}>
        <StatusBar style="light" />
        <CameraScreen onCapture={scanImage} onPhotos={chooseImage} onSettings={() => setSettingsVisible(true)} />
        {settingsSheet}
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, scanning && styles.safeAreaDark]}>
      <StatusBar style={scanning ? 'light' : 'dark'} />
      <View style={styles.flex}>
        {scanning && imageUri ? (
          <SnapshotScanningView uri={imageUri} sourceSize={imageSize} />
        ) : (
          <>
            <View style={styles.labelTopArea}>
              <View pointerEvents="none" style={styles.labelTopGlowLeft} />
              <View pointerEvents="none" style={styles.labelTopGlowRight} />
              <GlassSurface style={styles.labelTopChrome}>
                <View pointerEvents="none" style={styles.labelTopSheen} />
                <Header onBack={reset} onSettings={() => setSettingsVisible(true)} />
                <TabBar tab={tab} onChange={setTab} />
              </GlassSurface>
            </View>
            {error ? (
              <ErrorView message={error} onRetry={reset} />
            ) : tab === 'label' && imageUri ? (
              <ZoomableLabel
                uri={imageUri}
                sourceSize={imageSize}
                words={words}
                selected={selectedWord}
                translations={translations}
                translatingWord={translatingWord}
                visualWordStatus={visualWordStatus}
                translationLanguage={translationLanguage}
                onSelect={selectWord}
                onClearSelection={clearSelectedWord}
              />
            ) : (
              <SummaryView sections={summaryLanguage === 'en' ? sections : easyReadTranslations[summaryLanguage] ?? sections} language={summaryLanguage} translating={translatingSummary} onLanguageChange={changeSummaryLanguage} />
            )}
          </>
        )}
      </View>
      {settingsSheet}
    </SafeAreaView>
  );
}

function CameraScreen({ onCapture, onPhotos, onSettings }: { onCapture: (uri: string, width: number, height: number) => Promise<void>; onPhotos: () => void; onSettings: () => void }) {
  const camera = useRef<CameraView>(null);
  const askedForPermission = useRef(false);
  const configuredCamera = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [takingPhoto, setTakingPhoto] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [selectedLens, setSelectedLens] = useState<string>();
  const [macroLens, setMacroLens] = useState<string>();
  const [switchingToMacro, setSwitchingToMacro] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number }>();
  const [focusReticle, setFocusReticle] = useState<{ x: number; y: number; id: number }>();
  const [previewSize, setPreviewSize] = useState({ width: 1, height: 1 });
  const focusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (permission && !permission.granted && !askedForPermission.current) {
      askedForPermission.current = true;
      requestPermission();
    }
  }, [permission, requestPermission]);

  useEffect(() => () => {
    if (focusTimer.current) clearTimeout(focusTimer.current);
  }, []);

  const configureCamera = async () => {
    if (!camera.current || configuredCamera.current) return;
    configuredCamera.current = true;
    try {
      const lenses = await camera.current.getAvailableLensesAsync();
      const macro = lenses.find((lens) => lens.toLowerCase().replace(/[^a-z]/g, '').includes('ultrawide'));
      setMacroLens(macro);
      // Labels are close-range subjects, so start with the same Ultra-Wide
      // constituent that iPhone uses for Macro mode instead of waiting for a tap.
      setSelectedLens(macro);
      setSwitchingToMacro(Boolean(macro));
    } catch (reason) {
      console.warn('Could not query camera capabilities.', reason);
    }
    // Give the selected lens, continuous autofocus, and exposure time to settle.
    setTimeout(() => {
      setSwitchingToMacro(false);
      setCameraReady(true);
    }, 900);
  };

  const takePhoto = async () => {
    if (!camera.current || takingPhoto || !cameraReady || switchingToMacro) return;
    setTakingPhoto(true);
    try {
      const photo = await camera.current.takePictureAsync({ quality: 1, skipProcessing: false });
      if (photo) await onCapture(photo.uri, photo.width, photo.height);
    } catch (reason) {
      console.warn(reason);
      Alert.alert('Camera unavailable', 'MagMed could not take this photo. Please try again.');
      setTakingPhoto(false);
    }
  };

  const focusAtTouch = (x: number, y: number) => {
    if (!cameraReady || previewSize.width <= 1 || previewSize.height <= 1) return;
    const normalized = {
      x: Math.min(Math.max(x / previewSize.width, 0), 1),
      y: Math.min(Math.max(y / previewSize.height, 0), 1),
    };
    if (macroLens && selectedLens !== macroLens) {
      // Medicine labels are commonly closer than the main camera's minimum
      // focus distance. Switch to the autofocus-capable macro path first, then
      // deliver the tap point after the new capture device is active.
      setSwitchingToMacro(true);
      setSelectedLens(macroLens);
      setTimeout(() => {
        setFocusPoint(normalized);
        setSwitchingToMacro(false);
      }, 600);
    } else {
      setFocusPoint(normalized);
    }
    const id = Date.now();
    setFocusReticle({ x, y, id });
    if (focusTimer.current) clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => {
      setFocusReticle((current) => current?.id === id ? undefined : current);
    }, 2200);
  };

  if (!permission) return <View style={styles.cameraPermission}><ActivityIndicator size="large" color={COLORS.teal} /></View>;
  if (!permission.granted) {
    return <View style={styles.cameraPermission}><Text style={styles.permissionIcon}>📷</Text><Text style={styles.stateTitle}>Camera access needed</Text><Text style={styles.stateCopy}>Allow camera access to preview and photograph a medicine label.</Text><Pressable style={[styles.actionButton, styles.actionPrimary, styles.permissionButton]} onPress={requestPermission}><Text style={[styles.actionText, styles.actionPrimaryText]}>Allow Camera</Text></Pressable><Pressable onPress={onPhotos}><Text style={styles.photoLink}>Choose from Photos instead</Text></Pressable></View>;
  }

  return (
    <View style={styles.cameraScreen}>
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        facing="back"
        mode="picture"
        autofocus="off"
        focusPoint={focusPoint}
        flash="auto"
        enableTorch={torchEnabled}
        pictureSize="Photo"
        selectedLens={selectedLens}
        responsiveOrientationWhenOrientationLocked
        onCameraReady={configureCamera}
        onMountError={(event) => Alert.alert('Camera unavailable', event.message)}
      />
      <Pressable
        style={StyleSheet.absoluteFill}
        onLayout={(event) => setPreviewSize(event.nativeEvent.layout)}
        onPress={(event) => focusAtTouch(event.nativeEvent.locationX, event.nativeEvent.locationY)}
        accessibilityRole="button"
        accessibilityLabel="Camera preview"
        accessibilityHint="Tap the medicine label to focus the camera at that point"
      />
      <HamburgerButton onPress={onSettings} light accessibilityLabel="Open camera settings" />
      {focusReticle && (
        <View pointerEvents="none" style={[styles.focusReticle, { left: focusReticle.x - 30, top: focusReticle.y - 30 }]}>
          <View style={styles.focusReticleDot} />
        </View>
      )}
      {(!cameraReady || switchingToMacro) && <View pointerEvents="none" style={styles.cameraStatus}><ActivityIndicator size="small" color="white" /><Text style={styles.cameraStatusText}>Preparing macro camera…</Text></View>}
      <View style={styles.cameraControls}>
        <GlassSurface dark interactive style={styles.libraryGlass}><Pressable hitSlop={12} style={styles.libraryButton} onPress={onPhotos}><Text style={styles.libraryIcon}>▧</Text><Text style={styles.libraryLabel}>Photos</Text></Pressable></GlassSurface>
        <Pressable accessibilityLabel="Take label photo" disabled={takingPhoto || !cameraReady || switchingToMacro} onPress={takePhoto} style={({ pressed }) => [styles.shutterOuter, (!cameraReady || switchingToMacro) && styles.shutterDisabled, pressed && styles.shutterPressed]}><View style={styles.shutterInner}>{(takingPhoto || !cameraReady || switchingToMacro) && <ActivityIndicator color={COLORS.teal} />}</View></Pressable>
        <GlassSurface dark interactive style={[styles.libraryGlass, torchEnabled && styles.lightButtonActive]}><Pressable hitSlop={12} style={styles.libraryButton} onPress={() => setTorchEnabled((enabled) => !enabled)}><Text style={styles.libraryIcon}>{torchEnabled ? '☀' : '☼'}</Text><Text style={styles.libraryLabel}>{torchEnabled ? 'Light on' : 'Light'}</Text></Pressable></GlassSurface>
      </View>
    </View>
  );
}

function HomeScreen({ onCamera, onPhotos }: { onCamera: () => void; onPhotos: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.home}>
      <View style={styles.brandRow}><View style={styles.brandMark}><Text style={styles.brandCross}>✚</Text></View><Text style={styles.brand}>MagMed</Text></View>
      <View style={styles.heroCircle}><Text style={styles.heroIcon}>💊</Text></View>
      <Text style={styles.heroTitle}>Small print,{`\n`}made clear</Text>
      <Text style={styles.heroCopy}>Photograph a medicine label, translate words into Korean, and browse every detail in a larger format.</Text>
      <View style={styles.actionCard}>
        <ActionButton label="Take a label photo" icon="◉" primary onPress={onCamera} />
        <ActionButton label="Choose from Photos" icon="▧" onPress={onPhotos} />
      </View>
      <Text style={styles.privacy}>🔒  Label text is recognized on your device.</Text>
    </ScrollView>
  );
}

function ActionButton({ label, icon, primary, onPress }: { label: string; icon: string; primary?: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.actionButton, primary && styles.actionPrimary, pressed && styles.pressed]}><Text style={[styles.actionText, primary && styles.actionPrimaryText]}>{icon}   {label}</Text></Pressable>;
}

function HamburgerButton({ onPress, light, accessibilityLabel }: { onPress: () => void; light?: boolean; accessibilityLabel: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} hitSlop={12} onPress={onPress} style={({ pressed }) => [styles.hamburgerButton, light && styles.hamburgerButtonLight, pressed && styles.pressed]}>
      <View style={[styles.hamburgerLine, light && styles.hamburgerLineLight]} />
      <View style={[styles.hamburgerLine, light && styles.hamburgerLineLight]} />
      <View style={[styles.hamburgerLine, light && styles.hamburgerLineLight]} />
    </Pressable>
  );
}

function SettingsSheet({ visible, translationLanguage, snapshots, onClose, onTranslationLanguageChange, onOpenSnapshot, onDeleteSnapshot }: { visible: boolean; translationLanguage: TranslationLanguage; snapshots: StoredSnapshot[]; onClose: () => void; onTranslationLanguageChange: (language: TranslationLanguage) => void; onOpenSnapshot: (snapshot: StoredSnapshot) => void; onDeleteSnapshot: (snapshot: StoredSnapshot) => void }) {
  const [page, setPage] = useState<'settings' | 'snapshots'>('settings');
  const [sheetSettled, setSheetSettled] = useState(false);
  const sheetTranslateY = useRef(new Animated.Value(900)).current;
  useEffect(() => {
    setSheetSettled(false);
    sheetTranslateY.setValue(900);
    if (!visible) return undefined;
    setPage('settings');
    const openingAnimation = Animated.timing(sheetTranslateY, {
      toValue: 0,
      duration: 380,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    openingAnimation.start(({ finished }) => {
      if (finished) setSheetSettled(true);
    });
    return () => openingAnimation.stop();
  }, [sheetTranslateY, visible]);

  return (
    <Modal animationType="none" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.settingsModal}>
        <Pressable accessibilityLabel="Close settings" onPress={onClose} style={styles.settingsBackdrop} />
        <Animated.View style={[styles.settingsSheetFrame, { transform: [{ translateY: sheetTranslateY }] }]}>
          <GlassSurface style={[styles.settingsSheet, sheetSettled && styles.settingsSheetSettled]}>
            <View style={styles.settingsHandle} />
            <View style={styles.settingsHeader}>
              {page === 'snapshots' ? <Pressable hitSlop={10} onPress={() => setPage('settings')}><Text style={styles.settingsBack}>‹ Settings</Text></Pressable> : <View style={styles.settingsHeaderSide} />}
              <Text style={styles.settingsTitle}>{page === 'settings' ? 'Settings' : 'Stored snapshots'}</Text>
              <Pressable hitSlop={10} onPress={onClose}><Text style={styles.settingsDone}>Done</Text></Pressable>
            </View>

            {page === 'settings' ? (
              <View style={styles.settingsContent}>
                <Text style={styles.settingsSectionLabel}>TRANSLATION</Text>
                <Text style={styles.settingsSectionCopy}>Show an optional translation after identifying a word.</Text>
                <View style={styles.settingsLanguageGrid}>
                  {TRANSLATION_LANGUAGES.map((language) => (
                    <Pressable key={language.id} onPress={() => onTranslationLanguageChange(language.id)} style={[styles.settingsLanguageOption, translationLanguage === language.id && styles.settingsLanguageOptionActive]}>
                      <Text style={[styles.settingsLanguageText, translationLanguage === language.id && styles.settingsLanguageTextActive]}>{language.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.settingsSectionLabel}>STORED DATA</Text>
                <Pressable onPress={() => setPage('snapshots')} style={styles.settingsRow}>
                  <View><Text style={styles.settingsRowTitle}>Snapshots</Text><Text style={styles.settingsRowCopy}>{snapshots.length} saved medicine label{snapshots.length === 1 ? '' : 's'}</Text></View>
                  <Text style={styles.settingsChevron}>›</Text>
                </Pressable>
              </View>
            ) : (
              <ScrollView contentContainerStyle={styles.snapshotGrid}>
                {snapshots.length === 0 ? (
                  <View style={styles.emptySnapshots}><Text style={styles.emptySnapshotsIcon}>▧</Text><Text style={styles.emptySnapshotsTitle}>No snapshots yet</Text><Text style={styles.emptySnapshotsCopy}>Photos you analyze will be stored here.</Text></View>
                ) : snapshots.map((snapshot) => (
                  <View key={snapshot.id} style={styles.snapshotCard}>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Open snapshot from ${new Date(snapshot.createdAt).toLocaleString()}`} onPress={() => onOpenSnapshot(snapshot)}>
                      <Image source={{ uri: snapshot.uri }} resizeMode="cover" style={styles.snapshotThumbnail} />
                      <Text numberOfLines={1} style={styles.snapshotDate}>{new Date(snapshot.createdAt).toLocaleString()}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="Delete snapshot" hitSlop={8} onPress={() => onDeleteSnapshot(snapshot)} style={({ pressed }) => [styles.snapshotDelete, pressed && styles.snapshotDeletePressed]}>
                      <Text style={styles.snapshotDeleteText}>×</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}
          </GlassSurface>
        </Animated.View>
      </View>
    </Modal>
  );
}

function Header({ onBack, onSettings }: { onBack: () => void; onSettings: () => void }) {
  return <View style={styles.header}><Pressable accessibilityLabel="Take a new photo" hitSlop={12} onPress={onBack} style={({ pressed }) => [styles.headerBackButton, pressed && styles.pressed]}><Text style={styles.headerBackIcon}>‹</Text></Pressable><View pointerEvents="none" style={styles.headerMark}><View style={styles.headerMarkGlow} /><Text style={styles.headerMarkIcon}>✚</Text></View><HamburgerButton onPress={onSettings} accessibilityLabel="Open medicine label settings" /></View>;
}

function TabBar({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  return <GlassSurface interactive style={styles.tabs}><Pressable accessibilityRole="tab" accessibilityState={{ selected: tab === 'label' }} style={[styles.tab, tab === 'label' && styles.tabActive]} onPress={() => onChange('label')}><Text style={[styles.tabText, tab === 'label' && styles.tabTextActive]}>Label</Text></Pressable><Pressable accessibilityRole="tab" accessibilityState={{ selected: tab === 'summary' }} style={[styles.tab, tab === 'summary' && styles.tabActive]} onPress={() => onChange('summary')}><Text style={[styles.tabText, tab === 'summary' && styles.tabTextActive]}>Easy Read</Text></Pressable></GlassSurface>;
}

function ScanningView() {
  return <View style={styles.center}><View style={styles.scanMark}><Text style={styles.scanIcon}>⌗</Text></View><ActivityIndicator size="large" color={COLORS.teal} /><Text style={styles.stateTitle}>Analyzing photo ...</Text><Text style={styles.stateCopy}>Finding words and organizing label details…</Text></View>;
}

function SnapshotScanningView({ uri, sourceSize }: { uri: string; sourceSize: { width: number; height: number } }) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(Animated.timing(progress, {
      toValue: 1,
      duration: 1800,
      easing: Easing.linear,
      useNativeDriver: true,
    }));
    animation.start();
    return () => animation.stop();
  }, [progress]);

  const imageScale = viewport.width > 0 && viewport.height > 0
    ? Math.min(viewport.width / sourceSize.width, viewport.height / sourceSize.height)
    : 0;
  const frame = {
    width: sourceSize.width * imageScale,
    height: sourceSize.height * imageScale,
    left: (viewport.width - sourceSize.width * imageScale) / 2,
    top: (viewport.height - sourceSize.height * imageScale) / 2,
  };
  const edgeOpacity = (inputRange: number[]) => progress.interpolate({
    inputRange,
    outputRange: [0.25, 0.25, 1, 0.25, 0.25],
  });
  const glowOpacity = progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.2, 0.75, 0.2],
  });
  const glowScale = progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 1.012, 1],
  });

  return (
    <View style={styles.snapshot} onLayout={(event) => setViewport(event.nativeEvent.layout)}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
      {imageScale > 0 && (
        <View pointerEvents="none" style={[styles.analysisFrame, frame]}>
          <Animated.View style={[styles.analysisGlow, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />
          <View style={styles.analysisInnerBorder} />
          <Animated.View style={[styles.analysisEdge, styles.analysisEdgeTop, { opacity: edgeOpacity([0, 0.01, 0.12, 0.24, 1]) }]} />
          <Animated.View style={[styles.analysisEdge, styles.analysisEdgeRight, { opacity: edgeOpacity([0, 0.25, 0.37, 0.49, 1]) }]} />
          <Animated.View style={[styles.analysisEdge, styles.analysisEdgeBottom, { opacity: edgeOpacity([0, 0.5, 0.62, 0.74, 1]) }]} />
          <Animated.View style={[styles.analysisEdge, styles.analysisEdgeLeft, { opacity: edgeOpacity([0, 0.75, 0.87, 0.99, 1]) }]} />
          <View style={[styles.analysisCorner, styles.analysisCornerTL]} />
          <View style={[styles.analysisCorner, styles.analysisCornerTR]} />
          <View style={[styles.analysisCorner, styles.analysisCornerBL]} />
          <View style={[styles.analysisCorner, styles.analysisCornerBR]} />
        </View>
      )}
      <View style={styles.snapshotStatus}><ActivityIndicator color="white" /><Text style={styles.snapshotTitle}>Analyzing photo...</Text></View>
    </View>
  );
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <View style={styles.center}><Text style={styles.errorIcon}>⚠️</Text><Text style={styles.stateTitle}>Couldn’t read this label</Text><Text style={styles.stateCopy}>{message}</Text><Pressable style={[styles.actionButton, styles.actionPrimary, styles.retry]} onPress={onRetry}><Text style={[styles.actionText, styles.actionPrimaryText]}>Try another photo</Text></Pressable></View>;
}

function ZoomableLabel({ uri, sourceSize, words, selected, translations, translatingWord, visualWordStatus, translationLanguage, onSelect, onClearSelection }: { uri: string; sourceSize: { width: number; height: number }; words: WordBox[]; selected?: WordBox; translations: Record<string, string>; translatingWord?: string; visualWordStatus?: VisualWordStatus; translationLanguage: TranslationLanguage; onSelect: (word: WordBox, highlightedFrame?: Frame) => void; onClearSelection: () => void }) {
  const window = useWindowDimensions();
  const [viewport, setViewport] = useState({ width: window.width, height: Math.max(window.height - 165, 1) });
  const [swipePoints, setSwipePoints] = useState<SwipePoint[]>([]);
  const [persistentSwipe, setPersistentSwipe] = useState<{ points: SwipePoint[]; strokeWidth: number }>();
  const swipePointsRef = useRef<SwipePoint[]>([]);
  const fitScale = Math.min(viewport.width / sourceSize.width, viewport.height / sourceSize.height);
  const display = { width: sourceSize.width * fitScale, height: sourceSize.height * fitScale };
  const imageLeft = (viewport.width - display.width) / 2;
  const imageTop = (viewport.height - display.height) / 2;
  const translationEnabled = translationLanguage !== 'off';
  const selectedTranslationKey = selected ? translationCacheKey(selected.text || selected.id, translationLanguage) : '';

  const zoom = useSharedValue(1);
  const startZoom = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startTranslateX = useSharedValue(0);
  const startTranslateY = useSharedValue(0);
  const swipeHandled = useRef(false);

  useEffect(() => {
    if (!selected) setPersistentSwipe(undefined);
  }, [selected]);

  const pinchGesture = Gesture.Pinch()
    .runOnJS(true)
    .onBegin(() => {
      startZoom.value = zoom.value;
    })
    .onUpdate((event) => {
      zoom.value = Math.min(6, Math.max(1, startZoom.value * event.scale));
    });

  const twoFingerPanGesture = Gesture.Pan()
    .minPointers(2)
    .maxPointers(2)
    .minDistance(4)
    .runOnJS(true)
    .onBegin(() => {
      startTranslateX.value = translateX.value;
      startTranslateY.value = translateY.value;
    })
    .onUpdate((event) => {
      translateX.value = startTranslateX.value + event.translationX;
      translateY.value = startTranslateY.value + event.translationY;
    });

  const selectClosestPaintedWord = () => {
    if (swipeHandled.current || swipePointsRef.current.length === 0) return;
    const paintedFrame = screenPathToImageFrame(
      swipePointsRef.current,
      fitScale,
      display,
      viewport,
      zoom.value,
      translateX.value,
      translateY.value,
      sourceSize,
    );
    if (!paintedFrame) return;
    const word = findClosestWordToScreenPath(words, swipePointsRef.current, fitScale, display, viewport, zoom.value, translateX.value, translateY.value);
    swipeHandled.current = true;
    // The existing full-image OCR word is only a hint. The frame must come
    // from the user's actual painted stroke so the close OCR pass reads the
    // pixels they selected rather than trusting an earlier bounding box.
    const paintedWord: WordBox = {
      id: word?.id ?? `paint-${Date.now()}`,
      text: word?.text ?? '',
      frame: paintedFrame,
    };
    onSelect(paintedWord, paintedFrame);
  };

  const swipeGesture = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    .minDistance(1)
    .runOnJS(true)
    .onBegin((event) => {
      swipeHandled.current = false;
      const point = { x: event.x, y: event.y };
      swipePointsRef.current = [point];
      setSwipePoints([point]);
    })
    .onStart(() => {
      setPersistentSwipe(undefined);
    })
    .onUpdate((event) => {
      const point = { x: event.x, y: event.y };
      const updated = [...swipePointsRef.current, point];
      swipePointsRef.current = updated;
      setSwipePoints(updated);
    })
    .onEnd(() => {
      const imagePoints = screenPointsToImagePoints(
        swipePointsRef.current,
        fitScale,
        display,
        viewport,
        zoom.value,
        translateX.value,
        translateY.value,
      );
      if (imagePoints.length) {
        setPersistentSwipe({
          points: imagePoints.map((point) => ({ x: point.x * fitScale, y: point.y * fitScale })),
          strokeWidth: 34 / Math.max(zoom.value, 0.01),
        });
      }
      selectClosestPaintedWord();
      swipePointsRef.current = [];
      setSwipePoints([]);
    })
    .onFinalize((_event, success) => {
      if (success) return;
      swipePointsRef.current = [];
      setSwipePoints([]);
    });

  const dismissTapGesture = Gesture.Tap()
    .maxDuration(260)
    .maxDistance(8)
    .runOnJS(true)
    .onEnd((_event, success) => {
      if (success && selected) {
        // Let a nested Details Pressable finish its onPress before tap-away
        // dismissal can unmount the popup.
        setTimeout(onClearSelection, 120);
      }
    });

  const photoGesture = Gesture.Simultaneous(pinchGesture, twoFingerPanGesture, swipeGesture, dismissTapGesture);
  const canvasStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: zoom.value },
    ],
  }));

  return (
    <View
      style={styles.labelViewport}
      onLayout={(event) => setViewport(event.nativeEvent.layout)}
    >
      <GestureDetector gesture={photoGesture}>
        <View style={styles.flex}>
          <Reanimated.View collapsable={false} style={[styles.zoomCanvas, { width: display.width, height: display.height, left: imageLeft, top: imageTop }, canvasStyle]}>
            <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
            {persistentSwipe?.points.length ? (
              <Svg pointerEvents="none" width={display.width} height={display.height} style={StyleSheet.absoluteFill}>
                <Polyline
                  points={persistentSwipe.points.map((point) => `${point.x},${point.y}`).join(' ')}
                  fill="none"
                  stroke="rgba(236,72,153,0.40)"
                  strokeWidth={persistentSwipe.strokeWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            ) : null}
            {words.map((word) => {
              const displayedFrame = selected?.id === word.id ? selected.frame : word.frame;
              const box = { left: displayedFrame.left * fitScale, top: displayedFrame.top * fitScale, width: Math.max(displayedFrame.width * fitScale, 2), height: Math.max(displayedFrame.height * fitScale, 2) };
              return (
                <View
                  key={word.id}
                  pointerEvents="none"
                  style={[styles.wordBox, box]}
                />
              );
            })}
          </Reanimated.View>
          {swipePoints.length > 0 && (
            <Svg pointerEvents="none" width={viewport.width} height={viewport.height} style={StyleSheet.absoluteFill}>
              <Polyline
                points={swipePoints.map((point) => `${point.x},${point.y}`).join(' ')}
                fill="none"
                stroke="rgba(236,72,153,0.34)"
                strokeWidth={34}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          )}
          {selected && !persistentSwipe && <PersistentWordHighlight word={selected} scale={fitScale} displaySize={display} viewportSize={viewport} zoom={zoom} translateX={translateX} translateY={translateY} />}
          {selected && <TranslationBubble word={selected} scale={fitScale} displaySize={display} viewportSize={viewport} zoom={zoom} translateX={translateX} translateY={translateY} translation={translations[selectedTranslationKey]} translationEnabled={translationEnabled} loading={translatingWord === selectedTranslationKey} visualState={visualWordStatus?.wordId === selected.id ? visualWordStatus.state : undefined} onDetails={() => openGoogleDetails(selected.text)} />}
        </View>
      </GestureDetector>
      {!selected && <View pointerEvents="none" style={styles.hint}><Text style={styles.hintText}>Swipe a word to select · use two fingers to move or zoom</Text></View>}
    </View>
  );
}

function findClosestWordToScreenPath(words: WordBox[], points: SwipePoint[], fitScale: number, display: { width: number; height: number }, viewport: { width: number; height: number }, zoom: number, translateX: number, translateY: number): WordBox | undefined {
  const firstPoint = points[0];
  if (!firstPoint) return undefined;
  const segments = points.length > 1
    ? points.slice(1).map((point, index) => ({ start: points[index] ?? firstPoint, end: point }))
    : [{ start: firstPoint, end: firstPoint }];

  return words
    .map((word) => {
      const frame = wordFrameOnScreen(word, fitScale, display, viewport, zoom, translateX, translateY);
      const touchPadding = Math.min(7, Math.max(3, frame.height * 0.22));
      const intersects = segments.some(({ start, end }) => segmentIntersectsFrame(start, end, frame, touchPadding));
      if (!intersects) return undefined;
      const center = { x: frame.left + frame.width / 2, y: frame.top + frame.height / 2 };
      const distance = Math.min(...segments.map(({ start, end }) => pointToSegmentDistance(center, start, end)));
      const pointsInside = points.filter((point) => (
        point.x >= frame.left
        && point.x <= frame.left + frame.width
        && point.y >= frame.top
        && point.y <= frame.top + frame.height
      )).length;
      return { word, distance, pointsInside };
    })
    .filter((candidate): candidate is { word: WordBox; distance: number; pointsInside: number } => Boolean(candidate))
    .sort((a, b) => b.pointsInside - a.pointsInside || a.distance - b.distance)[0]?.word;
}

function screenPathToImageFrame(points: SwipePoint[], fitScale: number, display: { width: number; height: number }, viewport: { width: number; height: number }, zoom: number, translateX: number, translateY: number, imageSize: { width: number; height: number }): Frame | undefined {
  if (!points.length || fitScale <= 0 || zoom <= 0) return undefined;
  const brushRadius = 18;
  const minScreenX = Math.min(...points.map((point) => point.x)) - brushRadius;
  const maxScreenX = Math.max(...points.map((point) => point.x)) + brushRadius;
  const minScreenY = Math.min(...points.map((point) => point.y)) - brushRadius;
  const maxScreenY = Math.max(...points.map((point) => point.y)) + brushRadius;
  const [topLeft, bottomRight] = screenPointsToImagePoints(
    [{ x: minScreenX, y: minScreenY }, { x: maxScreenX, y: maxScreenY }],
    fitScale,
    display,
    viewport,
    zoom,
    translateX,
    translateY,
  );
  if (!topLeft || !bottomRight) return undefined;
  return clampFrameToImage({
    left: Math.min(topLeft.x, bottomRight.x),
    top: Math.min(topLeft.y, bottomRight.y),
    width: Math.abs(bottomRight.x - topLeft.x),
    height: Math.abs(bottomRight.y - topLeft.y),
  }, imageSize);
}

function screenPointsToImagePoints(points: SwipePoint[], fitScale: number, display: { width: number; height: number }, viewport: { width: number; height: number }, zoom: number, translateX: number, translateY: number): SwipePoint[] {
  if (fitScale <= 0 || zoom <= 0) return [];
  return points.map((point) => ({
    x: ((point.x - viewport.width / 2 - translateX) / zoom + display.width / 2) / fitScale,
    y: ((point.y - viewport.height / 2 - translateY) / zoom + display.height / 2) / fitScale,
  }));
}

function wordFrameOnScreen(word: WordBox, fitScale: number, display: { width: number; height: number }, viewport: { width: number; height: number }, zoom: number, translateX: number, translateY: number): Frame {
  return {
    left: viewport.width / 2 + translateX + zoom * (word.frame.left * fitScale - display.width / 2),
    top: viewport.height / 2 + translateY + zoom * (word.frame.top * fitScale - display.height / 2),
    width: word.frame.width * fitScale * zoom,
    height: word.frame.height * fitScale * zoom,
  };
}

function segmentIntersectsFrame(start: SwipePoint, end: SwipePoint, frame: Frame, padding: number): boolean {
  const left = frame.left - padding;
  const top = frame.top - padding;
  const right = frame.left + frame.width + padding;
  const bottom = frame.top + frame.height + padding;
  const inside = (point: SwipePoint) => point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
  if (inside(start) || inside(end)) return true;
  const topLeft = { x: left, y: top };
  const topRight = { x: right, y: top };
  const bottomRight = { x: right, y: bottom };
  const bottomLeft = { x: left, y: bottom };
  return segmentsIntersect(start, end, topLeft, topRight)
    || segmentsIntersect(start, end, topRight, bottomRight)
    || segmentsIntersect(start, end, bottomRight, bottomLeft)
    || segmentsIntersect(start, end, bottomLeft, topLeft);
}

function segmentsIntersect(a: SwipePoint, b: SwipePoint, c: SwipePoint, d: SwipePoint): boolean {
  const cross = (p: SwipePoint, q: SwipePoint, r: SwipePoint) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return ((abC <= 0 && abD >= 0) || (abC >= 0 && abD <= 0))
    && ((cdA <= 0 && cdB >= 0) || (cdA >= 0 && cdB <= 0));
}

function pointToSegmentDistance(point: SwipePoint, start: SwipePoint, end: SwipePoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const progress = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + progress * dx), point.y - (start.y + progress * dy));
}

function clampFrameToImage(frame: Frame, imageSize: { width: number; height: number }): Frame {
  const imageWidth = Math.max(1, Math.floor(imageSize.width));
  const imageHeight = Math.max(1, Math.floor(imageSize.height));
  const left = Math.min(imageWidth - 1, Math.max(0, Math.floor(frame.left)));
  const top = Math.min(imageHeight - 1, Math.max(0, Math.floor(frame.top)));
  const right = Math.max(left + 1, Math.min(imageWidth, Math.ceil(frame.left + frame.width)));
  const bottom = Math.max(top + 1, Math.min(imageHeight, Math.ceil(frame.top + frame.height)));
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function frameFromNormalizedCropBox(box: { x: number; y: number; width: number; height: number } | undefined, crop: Frame): Frame | undefined {
  if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite)) return undefined;
  const x = Math.min(999, Math.max(0, box.x));
  const y = Math.min(999, Math.max(0, box.y));
  const width = Math.min(1000 - x, Math.max(1, box.width));
  const height = Math.min(1000 - y, Math.max(1, box.height));
  const frame = {
    left: crop.left + crop.width * x / 1000,
    top: crop.top + crop.height * y / 1000,
    width: crop.width * width / 1000,
    height: crop.height * height / 1000,
  };
  if (frame.width < 2 || frame.height < 2 || frame.width > crop.width * 0.95 || frame.height > crop.height * 0.95) return undefined;
  return frame;
}

function contoursFromNormalizedCrop(contours: Array<{ points: Array<{ x: number; y: number }> }> | undefined, crop: Frame): SwipePoint[][] {
  if (!Array.isArray(contours)) return [];
  return contours
    .map((contour) => (Array.isArray(contour?.points) ? contour.points : [])
      .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
      .slice(0, 120)
      .map((point) => ({
        x: crop.left + crop.width * Math.min(1000, Math.max(0, point.x)) / 1000,
        y: crop.top + crop.height * Math.min(1000, Math.max(0, point.y)) / 1000,
      })))
    .filter((points) => points.length >= 3)
    .slice(0, 40);
}

function completeWordFrame(frame: Frame, candidate: WordBox | undefined, detectedText: string, words: WordBox[], imageSize: { width: number; height: number }): Frame {
  const detectedKey = translationKey(detectedText);
  const candidateKey = translationKey(candidate?.text ?? '');
  const matchesCandidate = Boolean(candidate && (!detectedKey || detectedKey === candidateKey));
  const candidateFrame = matchesCandidate ? candidate!.frame : undefined;
  const baseLeft = Math.min(frame.left, candidateFrame?.left ?? frame.left);
  const baseTop = Math.min(frame.top, candidateFrame?.top ?? frame.top);
  const baseRight = Math.max(frame.left + frame.width, candidateFrame ? candidateFrame.left + candidateFrame.width : frame.left + frame.width);
  const baseBottom = Math.max(frame.top + frame.height, candidateFrame ? candidateFrame.top + candidateFrame.height : frame.top + frame.height);
  const baseWidth = baseRight - baseLeft;
  const baseHeight = baseBottom - baseTop;
  const horizontalPadding = Math.max(1.5, baseHeight * 0.14, baseWidth * 0.025);
  const verticalPadding = Math.max(1, baseHeight * 0.08);
  let left = baseLeft - horizontalPadding;
  let right = baseRight + horizontalPadding;
  const centerY = (baseTop + baseBottom) / 2;

  const sameLineWords = words.filter((other) => {
    if (candidate && other.id === candidate.id) return false;
    const otherCenterY = other.frame.top + other.frame.height / 2;
    return Math.abs(otherCenterY - centerY) <= Math.max(baseHeight, other.frame.height) * 0.55;
  });
  const nearestLeft = sameLineWords
    .filter((other) => other.frame.left + other.frame.width <= baseLeft)
    .sort((a, b) => (b.frame.left + b.frame.width) - (a.frame.left + a.frame.width))[0];
  const nearestRight = sameLineWords
    .filter((other) => other.frame.left >= baseRight)
    .sort((a, b) => a.frame.left - b.frame.left)[0];
  if (nearestLeft) left = Math.max(left, nearestLeft.frame.left + nearestLeft.frame.width + 0.5);
  if (nearestRight) right = Math.min(right, nearestRight.frame.left - 0.5);

  return clampFrameToImage({
    left,
    top: baseTop - verticalPadding,
    width: Math.max(2, right - left),
    height: baseHeight + verticalPadding * 2,
  }, imageSize);
}

function PersistentWordHighlight({ word, scale, displaySize, viewportSize, zoom, translateX, translateY }: { word: WordBox; scale: number; displaySize: { width: number; height: number }; viewportSize: { width: number; height: number }; zoom: SharedValue<number>; translateX: SharedValue<number>; translateY: SharedValue<number> }) {
  const positionStyle = useAnimatedStyle(() => ({
    left: viewportSize.width / 2 + translateX.value + zoom.value * (word.frame.left * scale - displaySize.width / 2),
    top: viewportSize.height / 2 + translateY.value + zoom.value * (word.frame.top * scale - displaySize.height / 2),
    width: Math.max(2, word.frame.width * scale * zoom.value),
    height: Math.max(2, word.frame.height * scale * zoom.value),
  }));

  return (
    <Reanimated.View
      pointerEvents="none"
      style={[
        styles.persistentWordHighlight,
        positionStyle,
      ]}
    />
  );
}

function TranslationBubble({ word, scale, displaySize, viewportSize, zoom, translateX, translateY, translation, translationEnabled, loading, visualState, onDetails }: { word: WordBox; scale: number; displaySize: { width: number; height: number }; viewportSize: { width: number; height: number }; zoom: SharedValue<number>; translateX: SharedValue<number>; translateY: SharedValue<number>; translation?: string; translationEnabled: boolean; loading: boolean; visualState?: VisualWordStatus['state']; onDetails: () => void }) {
  const width = Math.min(190, viewportSize.width - 24);
  const estimatedHeight = visualState === 'analyzing' ? 72 : translationEnabled && word.text.trim() ? 128 : 100;
  const positionStyle = useAnimatedStyle(() => {
    const wordLeft = viewportSize.width / 2 + translateX.value + zoom.value * (word.frame.left * scale - displaySize.width / 2);
    const wordRight = viewportSize.width / 2 + translateX.value + zoom.value * ((word.frame.left + word.frame.width) * scale - displaySize.width / 2);
    const wordMiddleY = viewportSize.height / 2 + translateY.value + zoom.value * ((word.frame.top + word.frame.height / 2) * scale - displaySize.height / 2);
    const roomOnRight = viewportSize.width - wordRight;
    const roomOnLeft = wordLeft;
    const left = roomOnRight >= width + 10
      ? wordRight + 8
      : roomOnLeft >= width + 10
        ? wordLeft - width - 8
        : Math.min(Math.max(8, wordRight + 8), viewportSize.width - width - 8);
    const top = Math.min(Math.max(8, wordMiddleY - estimatedHeight / 2), viewportSize.height - estimatedHeight - 8);
    return { left, top };
  });

  return (
    <Reanimated.View style={[styles.translationPosition, { width }, positionStyle]}>
      <GlassSurface style={styles.translation}>
        {visualState === 'analyzing' ? (
          <View style={{ minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
            <ActivityIndicator size="small" color={COLORS.teal} />
            <Text style={styles.translationAnalyzing}>Analyzing…</Text>
          </View>
        ) : (
          <>
            <Text style={styles.translationEyebrow}>DETECTED WORD</Text>
            <Text numberOfLines={1} style={styles.translationSource}>
              {word.text || 'Word not detected'}
            </Text>
            {translationEnabled && Boolean(word.text.trim()) && (
              <View style={styles.translationResult}>
                <Text style={styles.translationTarget}>{translation ?? (loading ? 'Translating…' : 'Translation unavailable')}</Text>
                {loading && <ActivityIndicator size="small" color={COLORS.teal} />}
              </View>
            )}
            {Boolean(word.text.trim()) && (
              <Pressable
                accessibilityRole="link"
                accessibilityHint="Opens Google search results in your browser"
                hitSlop={8}
                onPress={(event) => {
                  event.stopPropagation();
                  onDetails();
                }}
                style={styles.detailsButton}
              >
                <Text style={styles.detailsText}>Search Google  ↗</Text>
              </Pressable>
            )}
          </>
        )}
      </GlassSurface>
    </Reanimated.View>
  );
}

function SummaryView({ sections, language, translating, onLanguageChange }: {
  sections: SummarySection[];
  language: SummaryLanguage;
  translating: boolean;
  onLanguageChange: (language: SummaryLanguage) => void;
}) {
  const [fontScale, setFontScale] = useState(1);
  const fontScaleRef = useRef(1);
  const pinchStartScale = useRef(1);
  const pinch = useMemo(() => Gesture.Pinch()
    .runOnJS(true)
    .onBegin(() => {
      pinchStartScale.current = fontScaleRef.current;
    })
    .onUpdate((event) => {
      const nextScale = Math.min(1.8, Math.max(0.9, pinchStartScale.current * event.scale));
      fontScaleRef.current = nextScale;
      setFontScale(nextScale);
    }), []);

  return (
    <GestureDetector gesture={pinch}>
      <ScrollView contentContainerStyle={styles.summary} showsVerticalScrollIndicator={false}>
        <View style={styles.summaryToolbar}>
          <View style={styles.summaryLanguageSwitch}>
            {([
              { id: 'en', label: 'EN' },
              { id: 'ko', label: '한국어' },
              { id: 'es', label: 'ES' },
              { id: 'ja', label: '日本語' },
            ] as Array<{ id: SummaryLanguage; label: string }>).map((option) => (
              <Pressable
                key={option.id}
                accessibilityRole="button"
                accessibilityState={{ selected: language === option.id }}
                onPress={() => onLanguageChange(option.id)}
                style={[styles.summaryLanguageButton, language === option.id && styles.summaryLanguageButtonActive]}
              >
                <Text style={[styles.summaryLanguageText, language === option.id && styles.summaryLanguageTextActive]}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.summaryZoomHint}>Zoom · {Math.round(fontScale * 100)}%</Text>
        </View>

        {translating ? (
          <View style={styles.summaryLoading}>
            <ActivityIndicator color={COLORS.teal} />
            <Text style={styles.summaryLoadingText}>Translating Easy Read…</Text>
          </View>
        ) : sections.map((section, index) => (
          <GlassSurface key={`${section.icon}-${index}`} style={styles.summaryCard}>
            <View style={[styles.summaryHeading, { backgroundColor: `${section.color}10`, borderLeftWidth: 4, borderLeftColor: section.color, borderTopLeftRadius: 19, borderTopRightRadius: 19 }]}>
              <Text style={[styles.summaryIcon, { color: section.color, fontSize: 21 * fontScale }]}>{section.icon}</Text>
              <Text style={[styles.summaryTitle, { fontSize: 20 * fontScale, lineHeight: 25 * fontScale }]}>{section.title}</Text>
            </View>
            <View style={styles.divider} />
            <SummarySectionBody title={section.title} content={section.content} fontScale={fontScale} accent={section.color} />
          </GlassSurface>
        ))}
        {!translating && (
          <Text style={[styles.disclaimer, { fontSize: 13 * fontScale, lineHeight: 19 * fontScale }]}>
            {{
              en: 'ⓘ  Translations and digitally recognized text may contain errors or omit important details. Always verify this information against the original medicine label and confirm any questions with your doctor or pharmacist before using the medicine.',
              ko: 'ⓘ  번역 및 디지털로 인식된 텍스트에는 오류가 있거나 중요한 내용이 누락될 수 있습니다. 약을 사용하기 전에 반드시 원래 의약품 라벨과 비교하여 확인하고, 궁금한 사항은 의사 또는 약사에게 문의하세요.',
              es: 'ⓘ  Las traducciones y el texto reconocido digitalmente pueden contener errores u omitir detalles importantes. Verifique siempre esta información con la etiqueta original del medicamento y consulte cualquier duda con su médico o farmacéutico antes de usarlo.',
              ja: 'ⓘ  翻訳およびデジタル認識された文章には、誤りや重要な情報の欠落が含まれる場合があります。薬を使用する前に、必ず元の医薬品ラベルと照合し、不明な点は医師または薬剤師に確認してください。',
            }[language]}
          </Text>
        )}
      </ScrollView>
    </GestureDetector>
  );
}

function SummarySectionBody({ title, content, fontScale, accent }: { title: string; content: string; fontScale: number; accent: string }) {
  const lines = content
    .split(/\n+/)
    .map((line) => line.trim().replace(/^(?:[-•▪◦]|\d+[.)])\s*/, ''))
    .filter(Boolean);
  const useBullets = title !== 'Other label information' || lines.length > 1;

  return (
    <View style={{ paddingHorizontal: 18, paddingVertical: 15, gap: 10 * fontScale }}>
      {lines.map((line, index) => (
        <View key={`${title}-line-${index}`} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          {useBullets && <Text style={{ width: 22 * fontScale, color: accent, fontSize: 19 * fontScale, lineHeight: 28 * fontScale, fontWeight: '900' }}>•</Text>}
          <Text selectable style={{ flex: 1, color: '#263740', fontSize: 18 * fontScale, lineHeight: 28 * fontScale }}>
            <SummaryLine line={line} accent={accent} />
          </Text>
        </View>
      ))}
    </View>
  );
}

function SummaryLine({ line, accent }: { line: string; accent: string }) {
  const labelMatch = line.match(/^([^:]{1,48}:)(.*)$/);
  const warningMatch = !labelMatch ? line.match(/^(Do not|Stop use(?: and ask a doctor)?|Ask a doctor|Keep out of reach of children)(.*)$/i) : undefined;
  const prefix = labelMatch?.[1] ?? warningMatch?.[1];
  const remainder = labelMatch?.[2] ?? warningMatch?.[2] ?? line;
  const pieces = remainder.split(/(\b\d+(?:[.,]\d+)?(?:\s*(?:mg|mcg|g|mL|ml|oz|tablets?|capsules?|doses?|hours?|minutes?|days?|years?|°[CF]))?\b)/gi);

  return (
    <>
      {prefix ? <Text style={{ fontWeight: '900', color: accent }}>{prefix}</Text> : null}
      {pieces.map((piece, index) => /^\d/.test(piece) ? <Text key={index} style={{ fontWeight: '900', color: accent }}>{piece}</Text> : <React.Fragment key={index}>{piece}</React.Fragment>)}
    </>
  );
}

function extractWordBoxes(result: any): WordBox[] {
  const output: WordBox[] = [];
  (result.blocks ?? []).forEach((block: any, blockIndex: number) => {
    (block.lines ?? []).forEach((line: any, lineIndex: number) => {
      if (line.elements?.length) {
        line.elements.forEach((element: any, wordIndex: number) => {
          if (element.frame && element.text) output.push({ id: `${blockIndex}-${lineIndex}-${wordIndex}`, text: element.text, frame: element.frame });
        });
      } else if (line.frame && line.text) {
        const tokens = line.text.trim().split(/\s+/);
        const total = Math.max(line.text.length, 1);
        let cursor = 0;
        tokens.forEach((text: string, wordIndex: number) => {
          const start = line.text.indexOf(text, cursor);
          const frame = { left: line.frame.left + line.frame.width * (start / total), top: line.frame.top, width: line.frame.width * (text.length / total), height: line.frame.height };
          output.push({ id: `${blockIndex}-${lineIndex}-${wordIndex}`, text, frame });
          cursor = start + text.length;
        });
      }
    });
  });
  return output;
}

function chooseHighlightedOcrWord(candidates: WordBox[], imageWidth: number, imageHeight: number, hint: string): WordBox | undefined {
  const hintKey = translationKey(hint);
  const center = { x: imageWidth / 2, y: imageHeight / 2 };
  return candidates
    .filter((candidate) => Boolean(translationKey(candidate.text)))
    .map((candidate) => {
      const candidateCenter = {
        x: candidate.frame.left + candidate.frame.width / 2,
        y: candidate.frame.top + candidate.frame.height / 2,
      };
      const normalizedDistance = Math.hypot(
        (candidateCenter.x - center.x) / Math.max(imageWidth, 1),
        (candidateCenter.y - center.y) / Math.max(imageHeight, 1),
      );
      const candidateKey = translationKey(candidate.text);
      const hintMatch = Boolean(hintKey) && candidateKey === hintKey;
      return { candidate, hintMatch, normalizedDistance };
    })
    .sort((a, b) => a.normalizedDistance - b.normalizedDistance || Number(b.hintMatch) - Number(a.hintMatch))[0]?.candidate;
}

function translationKey(text: string): string {
  return text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

async function loadStoredSnapshots(): Promise<StoredSnapshot[]> {
  snapshotDirectory.create({ idempotent: true, intermediates: true });
  if (!snapshotIndexFile.exists) return [];
  const parsed = JSON.parse(await snapshotIndexFile.text()) as StoredSnapshot[];
  return parsed.filter((snapshot) => new File(snapshot.uri).exists).slice(0, 50);
}

async function storeSnapshot(uri: string, width: number, height: number): Promise<StoredSnapshot> {
  snapshotDirectory.create({ idempotent: true, intermediates: true });
  const createdAt = new Date().toISOString();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const destination = new File(snapshotDirectory, `${id}.jpg`);
  await new File(uri).copy(destination, { overwrite: true });
  const snapshot = { id, uri: destination.uri, width, height, createdAt };
  const current = await loadStoredSnapshots();
  const updated = [snapshot, ...current].slice(0, 50);
  if (!snapshotIndexFile.exists) snapshotIndexFile.create({ intermediates: true });
  snapshotIndexFile.write(JSON.stringify(updated));
  return snapshot;
}

async function updateStoredSnapshotAnalysis(id: string, analysis: StoredAnalysis): Promise<StoredSnapshot | undefined> {
  const current = await loadStoredSnapshots();
  const existing = current.find((snapshot) => snapshot.id === id);
  if (!existing) return undefined;
  const updatedSnapshot: StoredSnapshot = { ...existing, analysis };
  const updated = current.map((snapshot) => snapshot.id === id ? updatedSnapshot : snapshot);
  if (!snapshotIndexFile.exists) snapshotIndexFile.create({ intermediates: true });
  snapshotIndexFile.write(JSON.stringify(updated));
  return updatedSnapshot;
}

async function deleteStoredSnapshot(id: string): Promise<StoredSnapshot[]> {
  const current = await loadStoredSnapshots();
  const target = current.find((snapshot) => snapshot.id === id);
  if (target) {
    const photo = new File(target.uri);
    if (photo.exists) photo.delete();
  }
  const updated = current.filter((snapshot) => snapshot.id !== id);
  if (!snapshotIndexFile.exists) snapshotIndexFile.create({ intermediates: true });
  snapshotIndexFile.write(JSON.stringify(updated));
  return updated;
}

function translationCacheKey(text: string, language: TranslationLanguage): string {
  return `${language}:${translationKey(text)}`;
}

function openGoogleDetails(sourceText: string) {
  const englishWord = sourceText.trim();
  if (!englishWord) return;
  Linking.openURL(`https://www.google.com/search?q=${encodeURIComponent(englishWord)}`).catch(() => {
    Alert.alert('Could not open browser', 'Please try again.');
  });
}

function summarizeLabel(text: string): SummarySection[] {
  const definitions = [
    { title: 'Directions', icon: '☷', color: COLORS.teal, keys: ['directions', 'dosage', 'how to use'] },
    { title: 'Active ingredients', icon: '●', color: COLORS.teal, keys: ['active ingredient'] },
    { title: 'Inactive ingredients', icon: '❧', color: '#58A56B', keys: ['inactive ingredient'] },
    { title: 'Warnings', icon: '▲', color: COLORS.orange, keys: ['warning', 'do not use', 'ask a doctor', 'stop use'] },
    { title: 'Uses', icon: '✚', color: COLORS.teal, keys: ['uses', 'indications', 'purpose'] },
    { title: 'Storage', icon: '♨', color: COLORS.teal, keys: ['storage', 'store at', 'store between', 'keep at'] },
  ];
  const buckets = new Map<string, string[]>();
  let current = 'Other label information';
  text.split(/\n+/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
    const lower = line.toLowerCase();
    const match = definitions.find((item) => item.keys.some((key) => lower.startsWith(key)));
    if (match) current = match.title;
    buckets.set(current, [...(buckets.get(current) ?? []), line]);
  });
  const ordered = [...definitions, { title: 'Other label information', icon: '▤', color: COLORS.teal, keys: [] }];
  return ordered.flatMap((item) => {
    const lines = buckets.get(item.title);
    return lines?.length ? [{ title: item.title, icon: item.icon, color: item.color, content: lines.join('\n') }] : [];
  });
}

const styles = StyleSheet.create({
  glassFallbackLight: { backgroundColor: 'rgba(250,252,251,0.90)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.82)' }, glassFallbackDark: { backgroundColor: 'rgba(13,18,18,0.76)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.20)' },
  safeArea: { flex: 1, backgroundColor: COLORS.canvas }, safeAreaDark: { backgroundColor: '#090C0E' }, flex: { flex: 1 }, home: { paddingHorizontal: 22, paddingBottom: 34, alignItems: 'center' },
  cameraScreen: { flex: 1, backgroundColor: '#050708' }, cameraPermission: { flex: 1, paddingHorizontal: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.canvas }, permissionIcon: { fontSize: 56 }, permissionButton: { alignSelf: 'stretch', marginTop: 24 }, photoLink: { color: COLORS.teal, fontSize: 16, fontWeight: '700', marginTop: 22 },
  focusReticle: { position: 'absolute', zIndex: 3, width: 60, height: 60, borderRadius: 12, borderWidth: 2, borderColor: '#FFE16A', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 3 }, focusReticleDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#FFE16A' },
  cameraStatus: { position: 'absolute', top: 54, alignSelf: 'center', borderRadius: 18, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: 'rgba(0,0,0,0.38)', flexDirection: 'row', alignItems: 'center', gap: 8 }, cameraStatusText: { color: 'white', fontSize: 12, fontWeight: '700' },
  cameraControls: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 116, paddingBottom: 22, paddingHorizontal: 30, backgroundColor: 'transparent', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, shutterOuter: { width: 76, height: 76, borderRadius: 38, borderWidth: 3, borderColor: 'rgba(255,255,255,0.96)', padding: 5, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }, shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'white', alignItems: 'center', justifyContent: 'center' }, shutterPressed: { transform: [{ scale: 0.94 }], opacity: 0.82 }, shutterDisabled: { opacity: 0.5 }, libraryGlass: { width: 62, height: 62, borderRadius: 31, overflow: 'hidden' }, libraryButton: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center' }, lightButtonActive: { backgroundColor: 'rgba(15,118,110,0.48)' }, libraryIcon: { color: 'white', fontSize: 23 }, libraryLabel: { color: 'white', fontSize: 10, fontWeight: '700', marginTop: 2 }, controlSpacer: { width: 68 },
  brandRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginTop: 14, marginBottom: 28 }, brandMark: { width: 34, height: 34, borderRadius: 11, backgroundColor: COLORS.teal, alignItems: 'center', justifyContent: 'center' }, brandCross: { color: 'white', fontSize: 20, fontWeight: '800' }, brand: { color: COLORS.navy, fontSize: 22, fontWeight: '800', marginLeft: 9 },
  heroCircle: { width: 152, height: 152, borderRadius: 76, backgroundColor: COLORS.mint, borderWidth: 15, borderColor: '#C7F0E5', alignItems: 'center', justifyContent: 'center' }, heroIcon: { fontSize: 68 }, heroTitle: { color: COLORS.navy, fontSize: 38, lineHeight: 42, letterSpacing: -1.2, fontWeight: '800', textAlign: 'center', marginTop: 20 }, heroCopy: { maxWidth: 350, color: '#60707D', fontSize: 17, lineHeight: 25, textAlign: 'center', marginTop: 13 },
  actionCard: { alignSelf: 'stretch', backgroundColor: 'white', borderRadius: 24, padding: 17, gap: 12, marginTop: 30, shadowColor: COLORS.navy, shadowOpacity: 0.09, shadowRadius: 16, shadowOffset: { width: 0, height: 7 } }, actionButton: { minHeight: 55, borderRadius: 15, borderWidth: 1.5, borderColor: '#C6D3D5', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }, actionPrimary: { backgroundColor: COLORS.teal, borderColor: COLORS.teal }, actionText: { color: COLORS.teal, fontSize: 17, fontWeight: '700' }, actionPrimaryText: { color: 'white' }, pressed: { opacity: 0.75, transform: [{ scale: 0.99 }] }, privacy: { color: '#6C7A84', fontSize: 13, marginTop: 22 },
  labelTopArea: { zIndex: 2, backgroundColor: '#EAF3F0', overflow: 'visible' }, labelTopGlowLeft: { position: 'absolute', top: -58, left: -46, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(84,214,185,0.34)' }, labelTopGlowRight: { position: 'absolute', top: -76, right: -24, width: 154, height: 154, borderRadius: 77, backgroundColor: 'rgba(105,166,255,0.24)' }, labelTopChrome: { paddingBottom: 13, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderTopWidth: 0, borderColor: 'rgba(255,255,255,0.82)', shadowColor: '#07110F', shadowOpacity: 0.16, shadowRadius: 22, shadowOffset: { width: 0, height: 9 } }, labelTopSheen: { position: 'absolute', top: 0, left: 26, right: 26, height: 1, backgroundColor: 'rgba(255,255,255,0.92)' }, header: { height: 54, paddingHorizontal: 16, paddingTop: 3, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, headerCopy: { flex: 1, justifyContent: 'center' }, headerSide: { width: 44, alignItems: 'center' }, headerBackButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.54)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.88)', shadowColor: COLORS.navy, shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }, headerBackIcon: { color: COLORS.navy, fontSize: 31, lineHeight: 33, fontWeight: '400', marginTop: -2 }, headerMark: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.teal, transform: [{ rotate: '8deg' }], shadowColor: COLORS.teal, shadowOpacity: 0.32, shadowRadius: 9, shadowOffset: { width: 0, height: 4 } }, headerMarkGlow: { position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.14)' }, headerMarkIcon: { color: 'white', fontSize: 20, lineHeight: 23, fontWeight: '800', transform: [{ rotate: '-8deg' }] }, back: { width: 100, color: COLORS.teal, fontSize: 16, fontWeight: '600' }, headerTitle: { color: COLORS.navy, fontSize: 19, lineHeight: 23, fontWeight: '800', letterSpacing: -0.35 }, headerSubtitle: { color: '#78847E', fontSize: 11, lineHeight: 15, fontWeight: '600', marginTop: 1 }, headerSettingsSlot: { width: 100, alignItems: 'flex-end' }, hamburgerButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', gap: 3.5, backgroundColor: 'rgba(255,255,255,0.54)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.88)', shadowColor: COLORS.navy, shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }, hamburgerButtonLight: { position: 'absolute', zIndex: 10, top: 52, right: 18, backgroundColor: 'rgba(8,12,14,0.78)', borderColor: 'rgba(255,255,255,0.48)', shadowColor: '#000', shadowOpacity: 0.34, shadowRadius: 9, shadowOffset: { width: 0, height: 4 } }, hamburgerLine: { width: 17, height: 1.5, borderRadius: 1, backgroundColor: COLORS.navy }, hamburgerLineLight: { backgroundColor: 'white' },
  tabs: { flexDirection: 'row', marginHorizontal: 16, marginTop: 3, padding: 4, borderRadius: 17, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.86)', shadowColor: COLORS.navy, shadowOpacity: 0.10, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }, tab: { flex: 1, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, tabActive: { backgroundColor: 'rgba(15,118,110,0.90)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.44)', shadowColor: COLORS.teal, shadowOpacity: 0.28, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }, tabText: { color: '#556762', fontSize: 13, fontWeight: '700' }, tabTextActive: { color: 'white', fontWeight: '800' },
  center: { flex: 1, paddingHorizontal: 30, alignItems: 'center', justifyContent: 'center' }, scanMark: { width: 104, height: 104, borderRadius: 25, backgroundColor: COLORS.mint, alignItems: 'center', justifyContent: 'center', marginBottom: 22 }, scanIcon: { color: COLORS.teal, fontSize: 55, fontWeight: '300' }, stateTitle: { color: COLORS.navy, fontSize: 23, fontWeight: '800', marginTop: 18, textAlign: 'center' }, stateCopy: { color: '#6D7981', fontSize: 16, lineHeight: 23, textAlign: 'center', marginTop: 7 }, errorIcon: { fontSize: 54 }, retry: { alignSelf: 'stretch', marginTop: 24 },
  snapshot: { flex: 1, backgroundColor: '#090C0E' }, snapshotStatus: { position: 'absolute', alignSelf: 'center', bottom: 28, borderRadius: 24, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: 'rgba(8,12,14,0.72)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)', flexDirection: 'row', gap: 10, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 5 } }, snapshotTitle: { color: 'white', fontSize: 15, fontWeight: '700', letterSpacing: 0.1 },
  analysisFrame: { position: 'absolute' }, analysisGlow: { position: 'absolute', top: -5, right: -5, bottom: -5, left: -5, borderWidth: 2, borderColor: 'rgba(85,230,209,0.9)', shadowColor: '#5FFFF0', shadowOpacity: 1, shadowRadius: 14, shadowOffset: { width: 0, height: 0 } }, analysisInnerBorder: { position: 'absolute', top: 3, right: 3, bottom: 3, left: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.42)' }, analysisEdge: { position: 'absolute', backgroundColor: '#62F5DF', shadowColor: '#5FFFF0', shadowOpacity: 1, shadowRadius: 9, shadowOffset: { width: 0, height: 0 } }, analysisEdgeTop: { left: 0, right: 0, top: 0, height: 3 }, analysisEdgeRight: { top: 0, bottom: 0, right: 0, width: 3 }, analysisEdgeBottom: { left: 0, right: 0, bottom: 0, height: 3 }, analysisEdgeLeft: { top: 0, bottom: 0, left: 0, width: 3 }, analysisCorner: { position: 'absolute', width: 22, height: 22, borderColor: '#B7FFF4', shadowColor: '#5FFFF0', shadowOpacity: 1, shadowRadius: 8 }, analysisCornerTL: { top: -3, left: -3, borderTopWidth: 4, borderLeftWidth: 4 }, analysisCornerTR: { top: -3, right: -3, borderTopWidth: 4, borderRightWidth: 4 }, analysisCornerBL: { bottom: -3, left: -3, borderBottomWidth: 4, borderLeftWidth: 4 }, analysisCornerBR: { bottom: -3, right: -3, borderBottomWidth: 4, borderRightWidth: 4 },
  labelViewport: { flex: 1, overflow: 'hidden', backgroundColor: '#111516' }, zoomCanvas: { position: 'absolute' }, wordBox: { position: 'absolute', zIndex: 2, borderRadius: 3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.01)', backgroundColor: 'rgba(255,255,255,0.01)' }, wordPressed: { backgroundColor: 'rgba(255,255,255,0.30)', borderColor: 'white' }, wordSwipeCandidate: { backgroundColor: 'rgba(255,221,64,0.42)', borderColor: 'rgba(255,245,166,0.96)', borderWidth: 1.5 }, wordSelected: { backgroundColor: 'rgba(239,68,68,0.38)', borderColor: 'transparent', borderWidth: 0 }, persistentWordHighlight: { position: 'absolute', zIndex: 4, borderRadius: 3, backgroundColor: 'rgba(236,72,153,0.42)' }, longPressHighlight: { position: 'absolute', width: 96, height: 40, borderRadius: 20, borderWidth: 2, borderColor: 'rgba(255,247,178,0.96)', backgroundColor: 'rgba(255,218,45,0.34)', shadowColor: '#FFE45E', shadowOpacity: 0.72, shadowRadius: 7, shadowOffset: { width: 0, height: 0 } }, translationControls: { position: 'absolute', zIndex: 8, top: 10, left: 12, right: 12, minHeight: 43, paddingLeft: 11, paddingRight: 4, borderRadius: 14, backgroundColor: 'rgba(8,12,14,0.76)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.2)', flexDirection: 'row', alignItems: 'center', gap: 8 }, translationControlsLabel: { color: 'white', fontSize: 11, fontWeight: '700' }, translationOptions: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 2 }, translationOption: { minHeight: 33, paddingHorizontal: 8, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, translationOptionActive: { backgroundColor: COLORS.teal }, translationOptionText: { color: '#C8D0D4', fontSize: 11, fontWeight: '700' }, translationOptionTextActive: { color: 'white' }, translationPosition: { position: 'absolute', zIndex: 5, borderRadius: 20, shadowColor: '#000', shadowOpacity: 0.34, shadowRadius: 24, shadowOffset: { width: 0, height: 11 } }, translation: { paddingHorizontal: 14, paddingVertical: 13, borderRadius: 20, overflow: 'hidden', backgroundColor: '#F8FBFA', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.96)' }, translationEyebrow: { color: '#718079', fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginBottom: 4 }, translationSource: { color: COLORS.navy, fontSize: 18, lineHeight: 22, fontWeight: '800' }, translationResult: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 7, paddingTop: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(87,104,96,0.18)' }, translationTarget: { flexShrink: 1, color: COLORS.teal, fontSize: 17, fontWeight: '800' }, translationAnalyzing: { color: COLORS.navy, fontSize: 14, fontWeight: '700' }, detailsButton: { alignSelf: 'flex-start', marginTop: 10, paddingVertical: 5, paddingHorizontal: 9, marginLeft: -9, borderRadius: 10 }, detailsText: { color: COLORS.teal, fontSize: 12, fontWeight: '800' }, translationFallback: { color: '#A45B24', fontSize: 9, lineHeight: 12, fontWeight: '600', marginTop: 5 }, translationLoader: { marginTop: 7, alignSelf: 'flex-start' }, hint: { position: 'absolute', alignSelf: 'center', bottom: 16, backgroundColor: 'rgba(12,16,17,0.62)', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)' }, hintText: { color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: '600', textAlign: 'center' },
  settingsModal: { flex: 1, justifyContent: 'flex-end' }, settingsBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(3,8,11,0.34)' }, settingsSheetFrame: { width: '100%', maxHeight: '82%' }, settingsSheet: { maxHeight: '100%', minHeight: 390, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 28, overflow: 'hidden', backgroundColor: '#F8FBFA', borderWidth: StyleSheet.hairlineWidth, borderBottomWidth: 0, borderColor: 'rgba(255,255,255,0.96)' }, settingsSheetSettled: { shadowColor: '#07110F', shadowOpacity: 0.24, shadowRadius: 24, shadowOffset: { width: 0, height: -7 } }, settingsHandle: { width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(78,94,87,0.34)', alignSelf: 'center', marginTop: 9 }, settingsHeader: { height: 54, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(78,94,87,0.16)' }, settingsHeaderSide: { width: 72 }, settingsTitle: { color: COLORS.navy, fontSize: 18, fontWeight: '800' }, settingsBack: { width: 72, color: COLORS.teal, fontSize: 15, fontWeight: '700' }, settingsDone: { width: 72, color: COLORS.teal, fontSize: 15, fontWeight: '800', textAlign: 'right' }, settingsContent: { padding: 18, gap: 10 }, settingsSectionLabel: { color: '#748087', fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginTop: 8 }, settingsSectionCopy: { color: '#617078', fontSize: 13, lineHeight: 18, marginBottom: 3 }, settingsLanguageGrid: { flexDirection: 'row', gap: 6, marginBottom: 16 }, settingsLanguageOption: { flex: 1, minHeight: 42, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(80,100,91,0.22)', backgroundColor: 'rgba(255,255,255,0.72)', alignItems: 'center', justifyContent: 'center' }, settingsLanguageOptionActive: { backgroundColor: 'rgba(15,118,110,0.88)', borderColor: 'rgba(255,255,255,0.44)' }, settingsLanguageText: { color: COLORS.navy, fontSize: 12, fontWeight: '700' }, settingsLanguageTextActive: { color: 'white' }, settingsRow: { minHeight: 70, paddingHorizontal: 16, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.76)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(80,100,91,0.18)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, settingsRowTitle: { color: COLORS.navy, fontSize: 17, fontWeight: '800' }, settingsRowCopy: { color: '#748087', fontSize: 12, marginTop: 3 }, settingsChevron: { color: '#82908F', fontSize: 28 }, snapshotGrid: { padding: 16, paddingBottom: 34, flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, snapshotCard: { width: '48%', padding: 7, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.82)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(80,100,91,0.18)' }, snapshotThumbnail: { width: '100%', aspectRatio: 0.78, borderRadius: 11, backgroundColor: '#DCE2E0' }, snapshotDate: { color: '#5F6D74', fontSize: 10, fontWeight: '600', marginTop: 7 }, snapshotDelete: { position: 'absolute', top: 12, right: 12, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(151,25,35,0.9)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.72)', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } }, snapshotDeletePressed: { opacity: 0.72, transform: [{ scale: 0.94 }] }, snapshotDeleteText: { color: 'white', fontSize: 23, lineHeight: 25, fontWeight: '500' }, emptySnapshots: { width: '100%', minHeight: 260, alignItems: 'center', justifyContent: 'center' }, emptySnapshotsIcon: { color: COLORS.teal, fontSize: 48 }, emptySnapshotsTitle: { color: COLORS.navy, fontSize: 19, fontWeight: '800', marginTop: 10 }, emptySnapshotsCopy: { color: '#748087', fontSize: 14, marginTop: 5 },
  summary: { padding: 16, gap: 14, paddingBottom: 30 }, summaryToolbar: { minHeight: 62, gap: 7 }, summaryLanguageSwitch: { width: '100%', flexDirection: 'row', padding: 3, borderRadius: 12, backgroundColor: 'rgba(222,230,226,0.66)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.72)' }, summaryLanguageButton: { flex: 1, minHeight: 36, paddingHorizontal: 5, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, summaryLanguageButtonActive: { backgroundColor: 'rgba(255,255,255,0.80)', shadowColor: COLORS.navy, shadowOpacity: 0.10, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } }, summaryLanguageText: { color: '#65747C', fontSize: 12, fontWeight: '700' }, summaryLanguageTextActive: { color: COLORS.navy }, summaryZoomHint: { color: '#728089', fontSize: 11, fontWeight: '600', textAlign: 'right', paddingRight: 3 }, summaryLoading: { minHeight: 220, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.60)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.76)', alignItems: 'center', justifyContent: 'center', gap: 12 }, summaryLoadingText: { color: '#61717A', fontSize: 15, fontWeight: '600' }, summaryCard: { borderRadius: 22, overflow: 'hidden', shadowColor: COLORS.navy, shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } }, summaryHeading: { flexDirection: 'row', alignItems: 'center', padding: 18 }, summaryIcon: { width: 32, fontSize: 21, fontWeight: '800' }, summaryTitle: { flex: 1, color: COLORS.navy, fontSize: 20, fontWeight: '800' }, divider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(75,95,86,0.16)', marginHorizontal: 18 }, summaryContent: { color: '#263740', fontSize: 18, lineHeight: 28, padding: 18 }, disclaimer: { color: '#6E7B83', fontSize: 13, lineHeight: 19, paddingHorizontal: 8, paddingVertical: 7 },
});
