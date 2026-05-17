import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { HomeScreen } from './src/screens/HomeScreen';
import { SearchingScreen } from './src/screens/SearchingScreen';
import { ReportScreen } from './src/screens/ReportScreen';
import { RootStackParamList } from './src/types';
import { colors } from './src/theme';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ title: 'Know Your Builder' }}
        />
        <Stack.Screen
          name="Searching"
          component={SearchingScreen}
          options={{ title: 'Searching…', headerBackVisible: false }}
        />
        <Stack.Screen
          name="Report"
          component={ReportScreen}
          options={{ title: 'Due Diligence Report', headerShown: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
