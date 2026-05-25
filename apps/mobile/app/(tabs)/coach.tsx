import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useStrideStore } from '../../src/store/useStrideStore';
import { strideApi } from '../../src/services/api';
import { Send, Sparkles, MessageSquare } from 'lucide-react-native';

export default function CoachScreen() {
  const { analysisId } = useLocalSearchParams<{ analysisId?: string }>();
  const scrollViewRef = useRef<ScrollView>(null);

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [typing, setTyping] = useState(false);

  // Initialize or fetch conversation
  const initConversation = async () => {
    setLoading(true);
    try {
      // Create new conversation (optionally linked to analysisId)
      const conv = await strideApi.createConversation(analysisId);
      setConversationId(conv.id);
      setMessages(conv.messages || []);
    } catch (err) {
      // Offline local dev fallback
      setConversationId('mock-conversation-uuid');
      setMessages([
        {
          role: 'assistant',
          content: analysisId 
            ? "Hey! I've loaded your biomechanics report. I noticed your lead knee drive is dropping early (measured at 82.5° vs the optimal 90°–95°). This reduces your stride length and vertical power. Ask me anything about your results or the prescribed A-Skips and Wall Drills!"
            : "Hey! I am Stride Coach. Ready to analyze your sprint mechanics, prescribe dynamic drills, and help you unlock serious track speed. Ask me anything about sprint form, warmups, or acceleration mechanics!",
          timestamp: new Date().toISOString()
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    initConversation();
  }, [analysisId]);

  const handleSendMessage = async (textToSend: string) => {
    const text = textToSend.trim();
    if (!text || !conversationId) return;

    setInputText('');
    const userMsg = {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setTyping(true);
    scrollViewRef.current?.scrollToEnd({ animated: true });

    try {
      const responseMsg = await strideApi.sendMessage(conversationId, text);
      setMessages((prev) => [...prev, responseMsg]);
    } catch (err) {
      // Offline mock response
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const mockCoachResponse = {
        role: 'assistant',
        content: text.toLowerCase().includes('knee drive')
          ? "To address that low knee drive, let's focus on the 'step over the opposite knee' cue during A-Skips. This reinforces dynamic hip flexion and locks your ankle in active dorsiflexion. Let's schedule 3 sets of 20 meters A-skips in your calendar. Sound good?"
          : "Understood. The key to horizontal speed is powerful triple extension at toe-off. We need complete extension across your hip, knee, and ankle to drive the track backwards. I highly recommend running hill sprints this week to emphasize this. Ask me how to execute it!",
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, mockCoachResponse]);
    } finally {
      setTyping(false);
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  const handleQuickCue = (cueText: string) => {
    handleSendMessage(cueText);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      style={styles.container}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleContainer}>
          <MessageSquare color="#FF453A" size={24} />
          <Text style={styles.headerTitle}>Stride Coach</Text>
        </View>
        <View style={styles.aiBadge}>
          <Sparkles color="#FF9F0A" size={12} fill="#FF9F0A" />
          <Text style={styles.aiBadgeText}>AI EXPERT</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#FF453A" />
          <Text style={styles.loadingText}>Initializing Coach Session...</Text>
        </View>
      ) : (
        <>
          {/* Messages Scroll Area */}
          <ScrollView
            ref={scrollViewRef}
            contentContainerStyle={styles.messagesList}
            onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
            showsVerticalScrollIndicator={false}
          >
            {messages.map((msg, idx) => {
              const isUser = msg.role === 'user';
              return (
                <View
                  key={idx}
                  style={[
                    styles.messageBubbleContainer,
                    isUser ? styles.userBubbleContainer : styles.coachBubbleContainer,
                  ]}
                >
                  <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.coachBubble]}>
                    <Text style={[styles.messageText, isUser ? styles.userMessageText : styles.coachMessageText]}>
                      {msg.content}
                    </Text>
                  </View>
                </View>
              );
            })}

            {typing && (
              <View style={[styles.messageBubbleContainer, styles.coachBubbleContainer]}>
                <View style={[styles.messageBubble, styles.coachBubble, styles.typingBubble]}>
                  <ActivityIndicator size="small" color="#FF453A" />
                  <Text style={styles.typingText}>Stride Coach is analyzing...</Text>
                </View>
              </View>
            )}
          </ScrollView>

          {/* Quick Cues Selection Panel */}
          {messages.length < 4 && !typing && (
            <View style={styles.quickCuesPanel}>
              <Text style={styles.quickCuesHeader}>Suggested Questions:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickCuesScroll}>
                {analysisId ? (
                  <>
                    <TouchableOpacity style={styles.cueChip} onPress={() => handleQuickCue('How do I fix my knee drive?')}>
                      <Text style={styles.cueChipText}>Fix Knee Drive</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.cueChip} onPress={() => handleQuickCue('Explain the A-Skips drill cues.')}>
                      <Text style={styles.cueChipText}>Explain A-Skips Cues</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.cueChip} onPress={() => handleQuickCue('What is my overall score based on?')}>
                      <Text style={styles.cueChipText}>Score Explanation</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <TouchableOpacity style={styles.cueChip} onPress={() => handleQuickCue('What are the best drills for starting block acceleration?')}>
                      <Text style={styles.cueChipText}>Acceleration Drills</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.cueChip} onPress={() => handleQuickCue('How do I maintain posture at max velocity?')}>
                      <Text style={styles.cueChipText}>Posture Tips</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.cueChip} onPress={() => handleQuickCue('How can I reduce braking forces / overstriding?')}>
                      <Text style={styles.cueChipText}>Reduce Overstriding</Text>
                    </TouchableOpacity>
                  </>
                )}
              </ScrollView>
            </View>
          )}

          {/* Input Bar */}
          <View style={styles.inputBar}>
            <TextInput
              style={styles.input}
              placeholder="Ask Stride Coach a question..."
              placeholderTextColor="#5C6073"
              value={inputText}
              onChangeText={setInputText}
              onSubmitEditing={() => handleSendMessage(inputText)}
            />
            <TouchableOpacity style={styles.sendButton} onPress={() => handleSendMessage(inputText)}>
              <Send color="#FFFFFF" size={18} />
            </TouchableOpacity>
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0D17',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#16192E',
    borderBottomColor: '#262940',
    borderBottomWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 16,
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 'bold',
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 159, 10, 0.15)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  aiBadgeText: {
    color: '#FF9F0A',
    fontWeight: 'bold',
    fontSize: 9,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    color: '#8E94A8',
    fontSize: 15,
  },
  messagesList: {
    padding: 20,
    gap: 16,
  },
  messageBubbleContainer: {
    flexDirection: 'row',
    width: '100%',
  },
  userBubbleContainer: {
    justifyContent: 'flex-end',
  },
  coachBubbleContainer: {
    justifyContent: 'flex-start',
  },
  messageBubble: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: '85%',
  },
  userBubble: {
    backgroundColor: '#FF453A',
    borderBottomRightRadius: 4,
  },
  coachBubble: {
    backgroundColor: '#16192E',
    borderBottomLeftRadius: 4,
    borderColor: '#262940',
    borderWidth: 1,
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
  },
  userMessageText: {
    color: '#FFFFFF',
    fontWeight: '500',
  },
  coachMessageText: {
    color: '#E4E6EB',
    lineHeight: 22,
  },
  typingText: {
    color: '#8E94A8',
    fontSize: 14,
  },
  quickCuesPanel: {
    backgroundColor: '#0F1122',
    borderTopColor: '#262940',
    borderTopWidth: 1,
    paddingVertical: 12,
  },
  quickCuesHeader: {
    color: '#FF9F0A',
    fontSize: 11,
    fontWeight: 'bold',
    paddingHorizontal: 20,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  quickCuesScroll: {
    paddingHorizontal: 16,
    gap: 10,
  },
  cueChip: {
    backgroundColor: '#1E254A',
    borderColor: '#262940',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  cueChipText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
  inputBar: {
    flexDirection: 'row',
    backgroundColor: '#16192E',
    borderTopColor: '#262940',
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 12,
  },
  input: {
    flex: 1,
    backgroundColor: '#0F1122',
    borderColor: '#262940',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#FFFFFF',
    fontSize: 15,
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FF453A',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
